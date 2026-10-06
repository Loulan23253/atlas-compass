/**
 * EXIF GPS 解析（纯函数单元，自 src/commands/Photos.ts 原样迁出）：
 * 手写 JPEG EXIF 解析器（II/MM 字节序、GPS IFD、DateTimeOriginal）。
 */

/** 从 JPEG 头部字节解析 EXIF GPS 与拍摄时间（只读前 256KB，够 EXIF；截断/畸形数据的任何异常一律按"无 GPS"处理） */
export function parseExifGps(buf: Uint8Array): { lat: number; lng: number; date: string | null } | null {
  try {
    return parseExifGpsInner(buf);
  } catch {
    return null;
  }
}

function parseExifGpsInner(buf: Uint8Array): { lat: number; lng: number; date: string | null } | null {
  if (buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  let tiff = -1;
  let little = true;
  // JPEG 段长度恒为大端（与 TIFF 字节序无关）
  const rd16be = (o: number) => (buf[o] << 8) | buf[o + 1];
  // TIFF 堆内 16/32 位读取按头部 II/MM 字节序
  const rd16 = (o: number) => (little ? buf[o] | (buf[o + 1] << 8) : (buf[o] << 8) | buf[o + 1]);
  const rd32 = (o: number) => (little ? buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24) : (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]);
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) break;
    const marker = buf[off + 1];
    const size = rd16be(off + 2);
    if (marker === 0xe1 && off + 10 <= buf.length) {
      // APP1 Exif
      const head = String.fromCharCode(...buf.slice(off + 4, off + 10));
      if (head === "Exif\0\0") {
        tiff = off + 10;
        // TIFF 头需要 8 字节（字节序标记 + IFD0 偏移），截断直接放弃
        if (tiff + 8 > buf.length) return null;
        little = String.fromCharCode(buf[tiff], buf[tiff + 1]) === "II";
        break;
      }
    }
    if (marker === 0xda) break; // SOS，EXIF 结束
    off += 2 + size;
  }
  if (tiff < 0) return null;
  const ifd0 = tiff + rd32(tiff + 4);

  // 遍历 IFD 找 GPS IFD(0x8825) 与 Exif IFD(0x8769)；逐项检查边界，畸形/截断数据提前终止
  type IfdEntry = { type: number; count: number; valueOff: number; inline: number[] };
  const walkIfd = (base: number): Map<number, IfdEntry> => {
    const entries = new Map<number, IfdEntry>();
    if (base < 0 || base + 2 > buf.length) return entries;
    const count = rd16(base);
    for (let i = 0; i < count; i++) {
      const e = base + 2 + i * 12;
      if (e + 12 > buf.length) break;
      const tag = rd16(e);
      const type = rd16(e + 2);
      const cnt = rd32(e + 4);
      const inlineBytes = buf.slice(e + 8, e + 12);
      entries.set(tag, { type, count: cnt, valueOff: e + 8, inline: [...inlineBytes] });
    }
    return entries;
  };

  const u32 = (o: number) => rd32(o) >>> 0;
  const rational = (o: number): number => {
    const num = u32(o);
    const den = u32(o + 4);
    return den ? num / den : 0;
  };
  // 条目内联存储的 4 字节值（IFD 指针/取值偏移）按 TIFF 字节序解释
  const inlineU32 = (b: number[]): number =>
    (little
      ? b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)
      : (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;

  const ifd0Entries = walkIfd(ifd0);
  const gpsPtr = ifd0Entries.get(0x8825);
  const exifPtr = ifd0Entries.get(0x8769);
  if (!gpsPtr) return null;
  const gpsIfd = tiff + inlineU32(gpsPtr.inline);
  const gps = walkIfd(gpsIfd);

  const latRef = gps.get(1);
  const latTag = gps.get(2);
  const lngRef = gps.get(3);
  const lngTag = gps.get(4);
  if (!latRef || !latTag || !lngRef || !lngTag) return null;
  const valueBase = (tag: { inline: number[] }): number => tiff + inlineU32(tag.inline);
  const latDMS = valueBase(latTag);
  const lngDMS = valueBase(lngTag);
  // 类型 5 RATIONAL 数据恒为外联（8 字节）：度/分/秒三组共 24 字节必须完整落在缓冲区内
  if (latDMS < 0 || latDMS + 24 > buf.length || lngDMS < 0 || lngDMS + 24 > buf.length) return null;
  let lat = rational(latDMS) + rational(latDMS + 8) / 60 + rational(latDMS + 16) / 3600;
  let lng = rational(lngDMS) + rational(lngDMS + 8) / 60 + rational(lngDMS + 16) / 3600;
  const latS = String.fromCharCode(gps.get(1)!.inline[0]);
  const lngS = String.fromCharCode(gps.get(3)!.inline[0]);
  if (latS === "S" || latS === "s") lat = -lat;
  if (lngS === "W" || lngS === "w") lng = -lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null; // 垃圾字节防护

  // 拍摄时间：Exif IFD 的 DateTimeOriginal (0x9003) "YYYY:MM:DD HH:MM:SS"
  let date: string | null = null;
  if (exifPtr) {
    const exifIfd = tiff + inlineU32(exifPtr.inline);
    const exifEntries = walkIfd(exifIfd);
    const dto = exifEntries.get(0x9003);
    if (dto) {
      const base = tiff + inlineU32(dto.inline);
      // 偏移越界时 slice 得到空串，自然不匹配
      const s = String.fromCharCode(...buf.slice(base, base + 10));
      const m = s.match(/^(\d{4}):(\d{2}):(\d{2})/);
      if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  return { lat, lng, date };
}
