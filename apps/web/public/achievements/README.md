# Achievement icons

Microsoft **Fluent Emoji** (3D), from
<https://github.com/microsoft/fluentui-emoji>, under the MIT licence.
Copied here rather than hot-linked so a profile never depends on another
server, and resized to 128px — they are shown at 28–40px.

One file per achievement tier, named after its id
(`packages/shared/src/achievements.ts`): `posts_1.png`, `tenure_4.png`
and so on. Adding a tier means adding its file; a missing one falls back
to the badge's text alone.
