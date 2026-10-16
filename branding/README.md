# Branding

Put your own icon here and point `FAVICON` in `.env` at it:

```ini
FAVICON=/branding/favicon.png
```

This folder is mounted read-only into the API container at `/branding`.
ICO, PNG, SVG, GIF, WebP and JPEG work; a square image of at least 512×512
gives the sharpest app icon. `FAVICON` may also be an `https://` address.
Restart with `docker compose up -d` after changing it.
