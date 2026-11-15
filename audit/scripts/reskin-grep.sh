#!/usr/bin/env bash
# R7 grep audit (docs/RESKIN.md): prints every leftover that breaks
# docs/DESIGN.md in frontend/src. Prints nothing and exits 0 when clean.
# ContactCard.jsx is excluded (unused; the owner decides whether to delete it).
cd "$(dirname "$0")/../../frontend/src" || exit 2
# grep -P reads \x{...} code points only in a UTF-8 locale (the emoji check).
export LC_ALL=C.UTF-8
EXCL=(--exclude=ContactCard.jsx)
found=0
check() { # <label> <grep -P pattern> [extra grep args...]
  local label="$1" pat="$2"; shift 2
  local out
  out=$(grep -rnP "${EXCL[@]}" --include='*.js' --include='*.jsx' --include='*.css' "$@" -e "$pat" . 2>/dev/null)
  if [ -n "$out" ]; then echo "## $label"; echo "$out"; found=1; fi
}
check 'shadow-'                         '\bshadow-'
check 'rounded- (other than full/none)' '\brounded-(?!full\b|none\b)'
# Classes and CSS only: the DOM's element.blur() call is not a blur effect.
check 'gradient / blur / backdrop'      '(gradient|\bblur(-[a-z0-9]+)?\b(?!\()|\bbackdrop-)'
check 'text-[Npx]'                      'text-\['
check 'text-white / bg-white / bg-black' '\b(text-white|bg-white|bg-black)\b'
check 'text-primary (use text-signal)'  '\btext-primary\b(?!-)'
check 'raw hex / rgb outside styles'    '(#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![\w-])|\brgba?\()' --exclude-dir=styles
check 'animate- (other than spin)'      '\banimate-(?!spin\b)'
check 'outline-none'                    '\boutline-none\b'
check 'emoji'                           '[\x{1F300}-\x{1FAFF}\x{2600}-\x{26FF}\x{2700}-\x{2712}\x{2714}-\x{27BF}\x{2B50}\x{FE0F}]'
exit $found
