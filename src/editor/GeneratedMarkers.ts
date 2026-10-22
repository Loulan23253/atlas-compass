import { StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { generatedMarkerRanges } from "../model/GeneratedMarkers";

const hiddenMarkers = (state: EditorState): DecorationSet => {
  const source = state.doc.toString();
  return Decoration.set(generatedMarkerRanges(source).map(({ from, to }) => {
    // 从前一行末尾到最后一个标记末尾，避免留下空行或把标题行号并到标记上。
    const start = from > 0 && source[from - 1] === "\n" ? from - 1 : from;
    const end = source[to - 1] === "\n" ? to - 1 : to;
    return Decoration.replace({ block: true, inclusive: false }).range(start, end);
  }));
};

/** 直接提供块装饰，编辑器可正确计算高度；光标跳过隐藏标记，底层文本不变。 */
export const generatedMarkersField = StateField.define<DecorationSet>({
  create: hiddenMarkers,
  update: (decorations, transaction) => transaction.docChanged ? hiddenMarkers(transaction.state) : decorations,
  provide: (field) => EditorView.decorations.from(field),
});

export const hideGeneratedMarkers = [
  generatedMarkersField,
  EditorView.atomicRanges.of((view) => view.state.field(generatedMarkersField)),
];
