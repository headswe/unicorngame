# Music

Drop an audio file in this folder and it becomes the game's background music —
no code change, no filename to register. `.mp3`, `.ogg`, `.m4a` and `.wav` are
picked up; Vite bundles whatever is here at build time.

Several files play as a playlist, in filename order. A single file loops.

It plays quietly (18% volume, see `VOLUME` in `src/engine/music.ts`), fades in,
stops when the tab is hidden, and can be switched off with the button in the
game — which is remembered between visits.

Nothing here means no music and no button, which is why the game ships silent
until a track is added.
