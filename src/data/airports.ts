/**
 * 常用机场点位数据（离线内置，纯静态）。
 * tier: 3 = 超级枢纽，2 = 大型干线，1 = 中型/区域性
 */
export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  tier: 1 | 2 | 3;
}

export const AIRPORTS: Airport[] = [
  // ===== 中国 =====
  { iata: "PVG", name: "上海浦东国际机场", city: "上海", country: "中国", lat: 31.1443, lng: 121.8083, tier: 3 },
  { iata: "SHA", name: "上海虹桥国际机场", city: "上海", country: "中国", lat: 31.1979, lng: 121.3363, tier: 3 },
  { iata: "PEK", name: "北京首都国际机场", city: "北京", country: "中国", lat: 40.0801, lng: 116.5846, tier: 3 },
  { iata: "PKX", name: "北京大兴国际机场", city: "北京", country: "中国", lat: 39.5098, lng: 116.4105, tier: 3 },
  { iata: "CAN", name: "广州白云国际机场", city: "广州", country: "中国", lat: 23.3924, lng: 113.2988, tier: 3 },
  { iata: "SZX", name: "深圳宝安国际机场", city: "深圳", country: "中国", lat: 22.6393, lng: 113.8107, tier: 2 },
  { iata: "NKG", name: "南京禄口国际机场", city: "南京", country: "中国", lat: 31.7420, lng: 118.8622, tier: 2 },
  { iata: "WUX", name: "苏南硕放国际机场", city: "无锡", country: "中国", lat: 31.4933, lng: 120.4292, tier: 1 },
  { iata: "HGH", name: "杭州萧山国际机场", city: "杭州", country: "中国", lat: 30.2295, lng: 120.4344, tier: 2 },
  { iata: "CTU", name: "成都双流国际机场", city: "成都", country: "中国", lat: 30.5785, lng: 103.9471, tier: 2 },
  { iata: "TFU", name: "成都天府国际机场", city: "成都", country: "中国", lat: 30.3125, lng: 104.4413, tier: 2 },
  { iata: "CKG", name: "重庆江北国际机场", city: "重庆", country: "中国", lat: 29.7192, lng: 106.6417, tier: 2 },
  { iata: "XIY", name: "西安咸阳国际机场", city: "西安", country: "中国", lat: 34.4471, lng: 108.7516, tier: 2 },
  { iata: "KMG", name: "昆明长水国际机场", city: "昆明", country: "中国", lat: 25.1019, lng: 102.9292, tier: 2 },
  { iata: "XMN", name: "厦门高崎国际机场", city: "厦门", country: "中国", lat: 24.5440, lng: 118.1277, tier: 2 },
  { iata: "TAO", name: "青岛胶东国际机场", city: "青岛", country: "中国", lat: 36.362, lng: 120.0882, tier: 2 },
  { iata: "DLC", name: "大连周水子国际机场", city: "大连", country: "中国", lat: 38.9657, lng: 121.5385, tier: 1 },
  { iata: "SHE", name: "沈阳桃仙国际机场", city: "沈阳", country: "中国", lat: 41.6398, lng: 123.4831, tier: 1 },
  { iata: "HRB", name: "哈尔滨太平国际机场", city: "哈尔滨", country: "中国", lat: 45.6234, lng: 126.2500, tier: 1 },
  { iata: "WUH", name: "武汉天河国际机场", city: "武汉", country: "中国", lat: 30.7838, lng: 114.2081, tier: 2 },
  { iata: "CSX", name: "长沙黄花国际机场", city: "长沙", country: "中国", lat: 28.1892, lng: 113.2196, tier: 2 },
  { iata: "CGO", name: "郑州新郑国际机场", city: "郑州", country: "中国", lat: 34.5197, lng: 113.8408, tier: 2 },
  { iata: "TSN", name: "天津滨海国际机场", city: "天津", country: "中国", lat: 39.1244, lng: 117.3462, tier: 1 },
  { iata: "TNA", name: "济南遥墙国际机场", city: "济南", country: "中国", lat: 36.8603, lng: 117.2164, tier: 1 },
  { iata: "FOC", name: "福州长乐国际机场", city: "福州", country: "中国", lat: 25.9350, lng: 119.6672, tier: 1 },
  { iata: "HAK", name: "海口美兰国际机场", city: "海口", country: "中国", lat: 19.9349, lng: 110.4589, tier: 2 },
  { iata: "SYX", name: "三亚凤凰国际机场", city: "三亚", country: "中国", lat: 18.3029, lng: 109.4123, tier: 2 },
  { iata: "NNG", name: "南宁吴圩国际机场", city: "南宁", country: "中国", lat: 22.6083, lng: 108.1717, tier: 1 },
  { iata: "KHN", name: "南昌昌北国际机场", city: "南昌", country: "中国", lat: 28.8653, lng: 115.9000, tier: 1 },
  { iata: "HFE", name: "合肥新桥国际机场", city: "合肥", country: "中国", lat: 31.9820, lng: 116.9800, tier: 1 },
  { iata: "NGB", name: "宁波栎社国际机场", city: "宁波", country: "中国", lat: 29.8267, lng: 121.4617, tier: 1 },
  { iata: "TYN", name: "太原武宿国际机场", city: "太原", country: "中国", lat: 37.7468, lng: 112.6281, tier: 1 },
  { iata: "URC", name: "乌鲁木齐地窝堡国际机场", city: "乌鲁木齐", country: "中国", lat: 43.9007, lng: 87.4739, tier: 2 },
  { iata: "LHW", name: "兰州中川国际机场", city: "兰州", country: "中国", lat: 36.5152, lng: 103.6203, tier: 1 },

  // ===== 日本 =====
  { iata: "NRT", name: "东京成田国际机场", city: "东京", country: "日本", lat: 35.7719, lng: 140.3928, tier: 3 },
  { iata: "HND", name: "东京羽田国际机场", city: "东京", country: "日本", lat: 35.5494, lng: 139.7798, tier: 3 },
  { iata: "KIX", name: "大阪关西国际机场", city: "大阪", country: "日本", lat: 34.4273, lng: 135.2440, tier: 3 },
  { iata: "ITM", name: "大阪伊丹机场", city: "大阪", country: "日本", lat: 34.7855, lng: 135.4382, tier: 2 },
  { iata: "NGO", name: "名古屋中部国际机场", city: "名古屋", country: "日本", lat: 34.8584, lng: 136.8054, tier: 2 },
  { iata: "CTS", name: "札幌新千岁机场", city: "札幌", country: "日本", lat: 42.7752, lng: 141.6923, tier: 2 },
  { iata: "FUK", name: "福冈机场", city: "福冈", country: "日本", lat: 33.5859, lng: 130.4510, tier: 2 },
  { iata: "OKA", name: "冲绳那霸机场", city: "那霸", country: "日本", lat: 26.1958, lng: 127.6459, tier: 2 },
  { iata: "SDJ", name: "仙台机场", city: "仙台", country: "日本", lat: 38.1397, lng: 140.9170, tier: 1 },
  { iata: "KOJ", name: "鹿儿岛机场", city: "鹿儿岛", country: "日本", lat: 31.8034, lng: 130.7190, tier: 1 },

  // ===== 亚太枢纽 =====
  { iata: "HKG", name: "香港国际机场", city: "香港", country: "中国香港", lat: 22.3080, lng: 113.9185, tier: 3 },
  { iata: "MFM", name: "澳门国际机场", city: "澳门", country: "中国澳门", lat: 22.1496, lng: 113.5919, tier: 1 },
  { iata: "TPE", name: "台北桃园国际机场", city: "台北", country: "中国台湾", lat: 25.0777, lng: 121.2328, tier: 2 },
  { iata: "ICN", name: "首尔仁川国际机场", city: "首尔", country: "韩国", lat: 37.4602, lng: 126.4407, tier: 3 },
  { iata: "GMP", name: "首尔金浦国际机场", city: "首尔", country: "韩国", lat: 37.5583, lng: 126.7906, tier: 1 },
  { iata: "SIN", name: "新加坡樟宜机场", city: "新加坡", country: "新加坡", lat: 1.3644, lng: 103.9915, tier: 3 },
  { iata: "BKK", name: "曼谷素万那普机场", city: "曼谷", country: "泰国", lat: 13.6900, lng: 100.7501, tier: 3 },
  { iata: "KUL", name: "吉隆坡国际机场", city: "吉隆坡", country: "马来西亚", lat: 2.7456, lng: 101.7099, tier: 2 },
  { iata: "DPS", name: "巴厘岛登巴萨机场", city: "登巴萨", country: "印度尼西亚", lat: -8.7482, lng: 115.1672, tier: 2 },
  { iata: "MLE", name: "马累国际机场", city: "马累", country: "马尔代夫", lat: 4.1918, lng: 73.5291, tier: 1 },

  // ===== 国际远程枢纽 =====
  { iata: "DXB", name: "迪拜国际机场", city: "迪拜", country: "阿联酋", lat: 25.2532, lng: 55.3657, tier: 3 },
  { iata: "CDG", name: "巴黎戴高乐机场", city: "巴黎", country: "法国", lat: 49.0097, lng: 2.5479, tier: 3 },
  { iata: "LHR", name: "伦敦希思罗机场", city: "伦敦", country: "英国", lat: 51.4700, lng: -0.4543, tier: 3 },
  { iata: "FRA", name: "法兰克福机场", city: "法兰克福", country: "德国", lat: 50.0379, lng: 8.5622, tier: 2 },
  { iata: "JFK", name: "纽约肯尼迪机场", city: "纽约", country: "美国", lat: 40.6413, lng: -73.7781, tier: 3 },
  { iata: "LAX", name: "洛杉矶国际机场", city: "洛杉矶", country: "美国", lat: 33.9416, lng: -118.4085, tier: 3 },
  { iata: "SFO", name: "旧金山国际机场", city: "旧金山", country: "美国", lat: 37.6213, lng: -122.3790, tier: 2 },
  { iata: "SYD", name: "悉尼金斯福德·史密斯机场", city: "悉尼", country: "澳大利亚", lat: -33.9399, lng: 151.1753, tier: 2 },

  // ===== 常用机场扩展（干线/旅游/国际枢纽，坐标取自 OurAirports）=====

  // —— 中国 ——
  { iata: "SJW", name: "石家庄正定国际机场", city: "石家庄", country: "中国", lat: 38.2807, lng: 114.6970, tier: 1 },
  { iata: "HET", name: "呼和浩特白塔国际机场", city: "呼和浩特", country: "中国", lat: 40.8497, lng: 111.8246, tier: 1 },
  { iata: "CGQ", name: "长春龙嘉国际机场", city: "长春", country: "中国", lat: 43.9962, lng: 125.6850, tier: 1 },
  { iata: "YNT", name: "烟台蓬莱国际机场", city: "烟台", country: "中国", lat: 37.6597, lng: 120.9781, tier: 1 },
  { iata: "WEH", name: "威海大水泊国际机场", city: "威海", country: "中国", lat: 37.1871, lng: 122.2290, tier: 1 },
  { iata: "WNZ", name: "温州龙湾国际机场", city: "温州", country: "中国", lat: 27.9106, lng: 120.8535, tier: 1 },
  { iata: "CZX", name: "常州奔牛国际机场", city: "常州", country: "中国", lat: 31.9205, lng: 119.7755, tier: 1 },
  { iata: "NTG", name: "南通兴东国际机场", city: "南通", country: "中国", lat: 32.0736, lng: 120.9801, tier: 1 },
  { iata: "XUZ", name: "徐州观音国际机场", city: "徐州", country: "中国", lat: 34.0591, lng: 117.5553, tier: 1 },
  { iata: "YTY", name: "扬州泰州国际机场", city: "扬州", country: "中国", lat: 32.5634, lng: 119.7198, tier: 1 },
  { iata: "JJN", name: "泉州晋江国际机场", city: "泉州", country: "中国", lat: 24.7959, lng: 118.5886, tier: 1 },
  { iata: "SWA", name: "揭阳潮汕国际机场", city: "揭阳", country: "中国", lat: 23.5520, lng: 116.5033, tier: 1 },
  { iata: "KWL", name: "桂林两江国际机场", city: "桂林", country: "中国", lat: 25.2198, lng: 110.0396, tier: 1 },
  { iata: "KWE", name: "贵阳龙洞堡国际机场", city: "贵阳", country: "中国", lat: 26.5418, lng: 106.8040, tier: 2 },
  { iata: "LJG", name: "丽江三义国际机场", city: "丽江", country: "中国", lat: 26.6775, lng: 100.2449, tier: 1 },
  { iata: "JHG", name: "西双版纳嘎洒国际机场", city: "西双版纳", country: "中国", lat: 21.9746, lng: 100.7622, tier: 1 },
  { iata: "INC", name: "银川河东国际机场", city: "银川", country: "中国", lat: 38.3228, lng: 106.3932, tier: 1 },
  { iata: "XNN", name: "西宁曹家堡国际机场", city: "西宁", country: "中国", lat: 36.5277, lng: 102.0402, tier: 1 },
  { iata: "HLD", name: "呼伦贝尔海拉尔机场", city: "呼伦贝尔", country: "中国", lat: 49.2086, lng: 119.8223, tier: 1 },
  { iata: "LXA", name: "拉萨贡嘎国际机场", city: "拉萨", country: "中国", lat: 29.2980, lng: 90.9120, tier: 1 },

  // —— 中国台湾 ——
  { iata: "KHH", name: "高雄国际机场", city: "高雄", country: "中国台湾", lat: 22.5771, lng: 120.3500, tier: 1 },

  // —— 日本 ——
  { iata: "AKJ", name: "旭川机场", city: "旭川", country: "日本", lat: 43.6708, lng: 142.4470, tier: 1 },
  { iata: "HKD", name: "函馆机场", city: "函馆", country: "日本", lat: 41.7700, lng: 140.8220, tier: 1 },
  { iata: "KIJ", name: "新潟机场", city: "新潟", country: "日本", lat: 37.9542, lng: 139.1122, tier: 1 },
  { iata: "KMQ", name: "小松机场", city: "小松", country: "日本", lat: 36.3934, lng: 136.4069, tier: 1 },
  { iata: "FSZ", name: "静冈机场", city: "静冈", country: "日本", lat: 34.7950, lng: 138.1910, tier: 1 },
  { iata: "OKJ", name: "冈山机场", city: "冈山", country: "日本", lat: 34.7569, lng: 133.8550, tier: 1 },
  { iata: "MYJ", name: "松山机场", city: "松山", country: "日本", lat: 33.8269, lng: 132.7001, tier: 1 },
  { iata: "OIT", name: "大分机场", city: "大分", country: "日本", lat: 33.4794, lng: 131.7370, tier: 1 },
  { iata: "KMJ", name: "熊本机场", city: "熊本", country: "日本", lat: 32.8373, lng: 130.8550, tier: 1 },
  { iata: "NGS", name: "长崎机场", city: "长崎", country: "日本", lat: 32.9169, lng: 129.9140, tier: 1 },

  // —— 泰国 ——
  { iata: "DMK", name: "廊曼国际机场", city: "曼谷", country: "泰国", lat: 13.9126, lng: 100.6070, tier: 2 },

  // —— 菲律宾 ——
  { iata: "MNL", name: "尼诺·阿基诺国际机场", city: "马尼拉", country: "菲律宾", lat: 14.5086, lng: 121.0200, tier: 2 },

  // —— 印度 ——
  { iata: "DEL", name: "英迪拉·甘地国际机场", city: "德里", country: "印度", lat: 28.5556, lng: 77.0952, tier: 2 },
  { iata: "BOM", name: "贾特拉帕蒂·希瓦吉国际机场", city: "孟买", country: "印度", lat: 19.0887, lng: 72.8679, tier: 2 },

  // —— 卡塔尔 ——
  { iata: "DOH", name: "哈马德国际机场", city: "多哈", country: "卡塔尔", lat: 25.2731, lng: 51.6081, tier: 3 },

  // —— 土耳其 ——
  { iata: "IST", name: "伊斯坦布尔机场", city: "伊斯坦布尔", country: "土耳其", lat: 41.2749, lng: 28.7321, tier: 3 },

  // —— 俄罗斯 ——
  { iata: "SVO", name: "谢列梅捷沃国际机场", city: "莫斯科", country: "俄罗斯", lat: 55.9769, lng: 37.4112, tier: 2 },

  // —— 德国 ——
  { iata: "MUC", name: "慕尼黑机场", city: "慕尼黑", country: "德国", lat: 48.3538, lng: 11.7861, tier: 2 },

  // —— 荷兰 ——
  { iata: "AMS", name: "史基浦机场", city: "阿姆斯特丹", country: "荷兰", lat: 52.3086, lng: 4.7639, tier: 3 },

  // —— 西班牙 ——
  { iata: "MAD", name: "巴拉哈斯机场", city: "马德里", country: "西班牙", lat: 40.4934, lng: -3.5722, tier: 2 },
  { iata: "BCN", name: "埃尔普拉特机场", city: "巴塞罗那", country: "西班牙", lat: 41.2971, lng: 2.0785, tier: 2 },

  // —— 意大利 ——
  { iata: "FCO", name: "菲乌米奇诺机场", city: "罗马", country: "意大利", lat: 41.8045, lng: 12.2520, tier: 2 },
  { iata: "MXP", name: "马尔彭萨机场", city: "米兰", country: "意大利", lat: 45.6306, lng: 8.7281, tier: 2 },

  // —— 瑞士 ——
  { iata: "ZRH", name: "苏黎世机场", city: "苏黎世", country: "瑞士", lat: 47.4581, lng: 8.5481, tier: 2 },

  // —— 奥地利 ——
  { iata: "VIE", name: "维也纳国际机场", city: "维也纳", country: "奥地利", lat: 48.1103, lng: 16.5697, tier: 2 },

  // —— 丹麦 ——
  { iata: "CPH", name: "凯斯楚普机场", city: "哥本哈根", country: "丹麦", lat: 55.6179, lng: 12.6560, tier: 2 },

  // —— 瑞典 ——
  { iata: "ARN", name: "阿兰达机场", city: "斯德哥尔摩", country: "瑞典", lat: 59.6485, lng: 17.9288, tier: 2 },

  // —— 挪威 ——
  { iata: "OSL", name: "加勒穆恩机场", city: "奥斯陆", country: "挪威", lat: 60.1939, lng: 11.1004, tier: 2 },

  // —— 爱尔兰 ——
  { iata: "DUB", name: "都柏林机场", city: "都柏林", country: "爱尔兰", lat: 53.4287, lng: -6.2621, tier: 2 },

  // —— 美国 ——
  { iata: "EWR", name: "纽瓦克自由国际机场", city: "纽瓦克", country: "美国", lat: 40.6894, lng: -74.1705, tier: 2 },
  { iata: "SEA", name: "塔科马国际机场", city: "西雅图", country: "美国", lat: 47.4479, lng: -122.3103, tier: 2 },
  { iata: "ORD", name: "奥黑尔国际机场", city: "芝加哥", country: "美国", lat: 41.9786, lng: -87.9048, tier: 3 },
  { iata: "DFW", name: "达拉斯沃斯堡国际机场", city: "达拉斯", country: "美国", lat: 32.8968, lng: -97.0380, tier: 2 },
  { iata: "ATL", name: "哈茨菲尔德-杰克逊机场", city: "亚特兰大", country: "美国", lat: 33.6367, lng: -84.4281, tier: 3 },
  { iata: "MIA", name: "迈阿密国际机场", city: "迈阿密", country: "美国", lat: 25.7960, lng: -80.2898, tier: 2 },
  { iata: "IAD", name: "杜勒斯国际机场", city: "华盛顿", country: "美国", lat: 38.9445, lng: -77.4558, tier: 2 },
  { iata: "BOS", name: "洛根国际机场", city: "波士顿", country: "美国", lat: 42.3620, lng: -71.0079, tier: 2 },

  // —— 加拿大 ——
  { iata: "YYZ", name: "皮尔逊国际机场", city: "多伦多", country: "加拿大", lat: 43.6759, lng: -79.6294, tier: 3 },
  { iata: "YVR", name: "温哥华国际机场", city: "温哥华", country: "加拿大", lat: 49.1939, lng: -123.1840, tier: 2 },

  // —— 墨西哥 ——
  { iata: "MEX", name: "贝尼托·华雷斯国际机场", city: "墨西哥城", country: "墨西哥", lat: 19.4358, lng: -99.0703, tier: 2 },

  // —— 巴西 ——
  { iata: "GRU", name: "瓜鲁柳斯国际机场", city: "圣保罗", country: "巴西", lat: -23.4313, lng: -46.4700, tier: 2 },

  // —— 阿根廷 ——
  { iata: "EZE", name: "埃塞萨国际机场", city: "布宜诺斯艾利斯", country: "阿根廷", lat: -34.8222, lng: -58.5358, tier: 2 },

  // —— 智利 ——
  { iata: "SCL", name: "阿图罗·梅里诺·贝尼特斯机场", city: "圣地亚哥", country: "智利", lat: -33.3930, lng: -70.7858, tier: 2 },

  // —— 澳大利亚 ——
  { iata: "MEL", name: "图拉马林机场", city: "墨尔本", country: "澳大利亚", lat: -37.6707, lng: 144.8379, tier: 2 },

  // —— 新西兰 ——
  { iata: "AKL", name: "奥克兰机场", city: "奥克兰", country: "新西兰", lat: -37.0120, lng: 174.7863, tier: 2 },

  // —— 南非 ——
  { iata: "JNB", name: "奥利弗·坦博国际机场", city: "约翰内斯堡", country: "南非", lat: -26.1401, lng: 28.2468, tier: 2 },

  // —— 埃及 ——
  { iata: "CAI", name: "开罗国际机场", city: "开罗", country: "埃及", lat: 30.1115, lng: 31.3967, tier: 2 },

  // —— 印度尼西亚 ——
  { iata: "CGK", name: "苏加诺-哈达国际机场", city: "雅加达", country: "印度尼西亚", lat: -6.1256, lng: 106.6560, tier: 2 },
];
