// Studio sections hidden for now (Jon, October 12). Set one to true to bring it back; nothing else
// needs to change. While the style mixer is hidden, the studio sends no styles and a reopened session
// doesn't bring its styles back. Images still lend their look through the request ("draw image 1 in
// the style of image 2"), and a design's "Use as style" does that for the member: it adds the design
// as the next numbered image and writes "in the style of image N" into the request
// (src/lib/styleRequest.ts). The server still takes styles, so nothing published with them changes.
export const SHOW_PROMPT_IDEAS = false;
export const SHOW_STYLE_MIXER = false;
