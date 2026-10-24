// Developer page: open the app with ?test=font (or ?test=font&set=2) to see
// how wide the firmware font draws candidate grid glyphs. Each row is 27
// copies of one glyph followed by the wall character; rows whose wall lines
// up with the ideographic-space row are safe to use in the text grid.
import { CreateStartUpPageContainer, TextContainerProperty, type EvenAppBridge } from '@evenrealities/even_hub_sdk'

export const GLYPH_SETS: readonly (readonly string[])[] = [
  ['　', '·', '・', '◌', '。', '．', '●', '○', '◎'],   // 　 · ・ ◌ 。 ． ● ○ ◎
  ['　', '◆', '◇', '■', '□', '★', '▩', '━', '┃'],   // 　 ◆ ◇ ■ □ ★ ▩ ━ ┃
  ['　', '／', '＼', '╱', '╲', '━', '┃', '┏', '┓'],   // directional aim candidates
  ['　', 'Ｂ', 'Ｕ', 'Ｌ', 'Ｓ', '１', '０', 'ａ', 'ｅ'],   // fullwidth Latin and digits
  ['　', '・', '▶', '◥', '◢', '＞', '★', '◎', '◌'],   // launcher and effects
  ['　', '┃', '┫', '┣', '╋', '╂', '┠', '█', '▮'],   // wall marker candidates
  ['　', '☆', '✦', '✧', '✪', '◉', '◍', '⊛', '▩'],   // special bubble candidates
  ['　', '┆', '┇', '╎', '║', 'Ｒ', 'Ｅ', 'Ａ', 'Ｄ'],   // dashed wall and READY letters
  ['　', 'Ｙ', 'Ｇ', 'Ｏ', '✸', '❋', '※', '⊕', '⊗'],   // GO letters and more specials
  ['　', '┗', '┛', '┳', '┻', '❖', '✿', '❀', '❧', '☙'],   // frame corners and ornaments (10 rows: does row 10 fit?)
  ['　', '♦', '♠', '♣', '♥', '◈', '▣', '▤', '▥', '▦'],   // more ornaments
  ['　', 'Ｃ', 'Ｆ', 'Ｈ', 'Ｉ', 'Ｊ', 'Ｋ', 'Ｍ', 'Ｎ', 'Ｐ'],   // remaining fullwidth letters
  ['　', 'Ｑ', 'Ｔ', 'Ｖ', 'Ｘ', 'Ｘ', 'Ｚ', '＋', '，', '：'],   // and punctuation
  ['　', '─', '┄', '┈', '╌', '…', '‥', '＿', '￣', '│'],   // light rules for a fainter frame
  ['　', '◐', '◑', '◒', '◓', '◔', '◕', '◘', '◙', '☢'],   // bomb candidates
  ['　', '？', '×', '✱', '✹', '☀', '☼', '♨', '⚡', '✖'],   // mystery, multiplier and more bomb candidates
]

export function fontTestText(set: number): string {
  const glyphs = GLYPH_SETS[Math.max(0, Math.min(GLYPH_SETS.length - 1, set - 1))]
  return glyphs.map((g) => g.repeat(27) + '┃').join('\n')
}

export async function runFontTest(bridge: EvenAppBridge, set: number): Promise<string> {
  const content = fontTestText(set)
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          containerID: 1, containerName: 'font', content,
          xPosition: 0, yPosition: 0, width: 576, height: 288, isEventCapture: 1, paddingLength: 0,
        }),
      ],
    }),
  )
  return content
}
