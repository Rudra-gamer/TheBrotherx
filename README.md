# Subham Prusty Films

Netlify-ready portfolio app with an admin panel for pricing, categories, videos, and inquiry management.

## Source files

- Public homepage source: `index.html`
- Admin page source: `admin/index.html`
- Seed content: `data/content.json`
- Netlify Functions: `netlify/functions/`

## Useful scripts

```bash
npm run check
npm run build:netlify
```

## Notes

- Pricing, media, and admin-managed seed content live in `data/content.json`.
- Runtime app content and inquiries are stored in Netlify Blobs.
- Media uploads go directly to Cloudinary from the browser.

## Deploy on Netlify

This repository now includes a Netlify-native deployment path:

- Static site output is built into `dist/`
- API routes are handled by `netlify/functions/api.mjs`
- Uploaded media goes directly from the browser to Cloudinary
- App content and inquiries are stored in Netlify Blobs
- The admin page is published at `/admin`

### Netlify settings

- Build command: `npm run build:netlify`
- Publish directory: `dist`

These are already configured in `netlify.toml`.

### Required Netlify environment variables

- `APP_ORIGIN=https://your-domain.example`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=<strong password>`
- `SESSION_SECRET=<long random secret>`
- `CLOUDINARY_CLOUD_NAME=<your cloud name>`
- `CLOUDINARY_API_KEY=<your api key>`
- `CLOUDINARY_API_SECRET=<your api secret>`

Optional:

- `CLOUDINARY_UPLOAD_FOLDER=subham-films`
- `MAX_UPLOAD_BYTES=104857600`

### Why Cloudinary is used for uploads

Netlify Functions are not a good path for large video file bodies. This app now avoids that bottleneck by requesting a signed upload from Netlify and then uploading the actual video directly from the browser to Cloudinary.

That means your upload limit is no longer tied to Netlify's request body cap. It is now mainly determined by your Cloudinary plan and the `MAX_UPLOAD_BYTES` value you set.
