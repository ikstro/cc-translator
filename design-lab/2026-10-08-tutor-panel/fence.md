# Fence: Tutor panel UX iteration (v0.3)

Mode: operate. Sized as a refinement: fence, restraint and finish pass, no idea board.

LOCKS
- VS Code theme tokens and codicons are the design system (the panel lives inside VS Code).
- The main Claude conversation stays untouched; the tutor lives only in the panel (project memory).
- Speech only on demand; reading each reply aloud is an option (owner).
- Pen use: targets at least 24px, nothing depends on hover (owner, this session).
- Sidebar width 280 to 420px; dark and light themes.

FREE AXES
- Header composition, how a translation is revealed, player states, settings form, language list, message layout, empty and off states, scrolling.

RUT (excluded)
- Category default: a settings form pushing the list down; a button on every line.
- Predictable opposite: everything hidden behind a "…" menu.

TASTE
- Secondary actions stay attached inside their block (paxio, 2026-10-05).

OWNER DECISIONS
- Settings as a sheet over the list, closed by Done, Esc or a tap outside.
- Tap a sentence to show or hide its translation; no hover behavior; the language-code button shows all.
- The speaker stays and becomes Stop while playing, per sentence and per reply.
- The language chip in the header opens the settings; no gear.

SHOTS
- shots/01 to 08: dark and light, 300 and 340px, tap, playing with word highlight, show-all, settings sheet, language list, off state.
