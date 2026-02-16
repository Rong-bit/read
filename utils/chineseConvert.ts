import * as OpenCC from 'opencc-js';

let cn2twConverter: ((input: string) => string) | null = null;

function getCn2TwConverter() {
  if (cn2twConverter) return cn2twConverter;
  // CN(简体) -> TW(繁体，台湾用字)
  cn2twConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });
  return cn2twConverter;
}

export function convertSimplifiedToTraditional(input: string): string {
  if (!input) return input;
  try {
    const converter = getCn2TwConverter();
    return converter(input);
  } catch {
    // 轉換失敗時，回傳原文以免影響閱讀
    return input;
  }
}

