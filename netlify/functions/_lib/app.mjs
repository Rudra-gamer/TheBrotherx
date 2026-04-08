import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { getStore } from '@netlify/blobs';

const DATA_STORE_NAME = 'subham-admin-data';
const SESSION_COOKIE = 'subham_admin_session';

const seedContentUrl = new URL('../../../data/content.json', import.meta.url);

const VALID_LAYOUTS = new Set(['packages', 'commercial', 'design']);
const VALID_VARIANTS = new Set(['package', 'commercial', 'design']);
const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.mp4',
  '.webm',
  '.ogg',
  '.mov'
]);

class HttpError extends Error {
  constructor(statusCode, message, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.headers = headers;
  }
}

function env(name, fallback = '') {
  const netlifyValue = globalThis.Netlify?.env?.get?.(name);
  if (netlifyValue !== undefined && netlifyValue !== null && netlifyValue !== '') return netlifyValue;
  if (process.env[name] !== undefined && process.env[name] !== '') return process.env[name];
  return fallback;
}

function readPositiveNumber(name, fallback) {
  const raw = env(name, '');
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: expected a positive number.`);
  }
  return value;
}

const CONTEXT = env('CONTEXT', env('NODE_ENV', 'development'));
const IS_PRODUCTION = CONTEXT === 'production';
const APP_ORIGIN = String(env('APP_ORIGIN', '')).trim();
const ADMIN_USERNAME = String(env('ADMIN_USERNAME', 'admin')).trim();
const ADMIN_PASSWORD = String(env('ADMIN_PASSWORD', 'admin123'));
const SESSION_SECRET = String(env('SESSION_SECRET', env('ADMIN_PASSWORD', 'development-secret')));
const SESSION_TTL_MS = readPositiveNumber('SESSION_TTL_MS', 7 * 24 * 60 * 60 * 1000);
const MAX_JSON_BYTES = readPositiveNumber('MAX_JSON_BYTES', 1024 * 1024);
const MAX_UPLOAD_BYTES = readPositiveNumber('MAX_UPLOAD_BYTES', 100 * 1024 * 1024);
const COOKIE_SECURE = String(env('COOKIE_SECURE', APP_ORIGIN.startsWith('https://') || IS_PRODUCTION ? 'true' : 'false')).toLowerCase() === 'true';
const CLOUDINARY_CLOUD_NAME = String(env('CLOUDINARY_CLOUD_NAME', '')).trim();
const CLOUDINARY_API_KEY = String(env('CLOUDINARY_API_KEY', '')).trim();
const CLOUDINARY_API_SECRET = String(env('CLOUDINARY_API_SECRET', '')).trim();
const CLOUDINARY_UPLOAD_FOLDER = sanitizeText(env('CLOUDINARY_UPLOAD_FOLDER', 'subham-films'), 120);

function dataStore() {
  return getStore(DATA_STORE_NAME);
}

function securityHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "media-src 'self' blob: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'"
    ].join('; '),
    ...extra
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: securityHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    })
  });
}

function textResponse(payload, status = 200, headers = {}) {
  return new Response(payload, {
    status,
    headers: securityHeaders({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    })
  });
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeContent(raw) {
  return {
    pricingCategories: Array.isArray(raw?.pricingCategories) ? raw.pricingCategories : [],
    pricingItems: Array.isArray(raw?.pricingItems) ? raw.pricingItems : [],
    media: Array.isArray(raw?.media) ? raw.media : [],
    settings: raw?.settings && typeof raw.settings === 'object' ? raw.settings : {}
  };
}

async function readSeedContent() {
  try {
    const raw = await fs.readFile(seedContentUrl, 'utf8');
    return normalizeContent(JSON.parse(raw));
  } catch {
    return normalizeContent({});
  }
}

async function loadContent() {
  const existing = await dataStore().get('content', { type: 'json' });
  if (existing) return normalizeContent(existing);
  return readSeedContent();
}

async function saveContent(content) {
  await dataStore().setJSON('content', content);
}

async function loadInquiries() {
  const existing = await dataStore().get('inquiries', { type: 'json' });
  return Array.isArray(existing) ? existing : [];
}

async function saveInquiries(inquiries) {
  await dataStore().setJSON('inquiries', inquiries);
}

function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part && part.includes('='))
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sanitizeText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeText(item, 140)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((item) => sanitizeText(item, 140))
      .filter(Boolean);
  }
  return [];
}

function safeCompareStrings(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeUrl(value, allowAnchor = false) {
  const input = sanitizeText(value, 500);
  if (!input) return '';
  if (allowAnchor && input.startsWith('#')) return input;
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new HttpError(400, 'Invalid URL value.');
  }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
    throw new HttpError(400, 'Unsupported URL protocol.');
  }
  return parsed.toString();
}

function sanitizeStoredFilename(value) {
  const input = sanitizeText(value, 255);
  if (!input) return '';
  const base = path.basename(input);
  if (base !== input || !/^[a-zA-Z0-9._-]+$/.test(base)) {
    throw new HttpError(400, 'Invalid file name.');
  }
  return base;
}

function makeId(prefix = 'item') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function publicMediaShape(item) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    emoji: item.emoji,
    filename: item.filename || '',
    externalUrl: item.externalUrl || '',
    resourceType: item.resourceType || '',
    publicId: item.publicId || '',
    featured: Boolean(item.featured)
  };
}

function createSessionToken() {
  const payload = {
    username: ADMIN_USERNAME,
    exp: Date.now() + SESSION_TTL_MS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function getSessionFromRequest(request) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encodedPayload).digest('base64url');
  if (!safeCompareStrings(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload || payload.username !== ADMIN_USERNAME || Number(payload.exp) < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

function requireAdmin(request) {
  const session = getSessionFromRequest(request);
  if (!session) {
    throw new HttpError(401, 'Unauthorized');
  }
  return session;
}

async function readJsonBody(request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) {
    throw new HttpError(413, `Payload too large. Max size is ${formatBytes(MAX_JSON_BYTES)}.`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function enforceOrigin(request) {
  const allowedOrigins = new Set(
    [APP_ORIGIN, env('URL', ''), env('DEPLOY_PRIME_URL', ''), env('DEPLOY_URL', '')]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  if (!allowedOrigins.size) return;
  const origin = request.headers.get('origin');
  if (!origin) return;
  if (!allowedOrigins.has(origin)) {
    throw new HttpError(403, 'Origin not allowed.');
  }
}

function cloudinaryEnabled() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
}

function requireCloudinary() {
  if (!cloudinaryEnabled()) {
    throw new HttpError(500, 'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
  }
}

function signCloudinaryParams(params) {
  const base = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`)
    .join('&');

  return crypto.createHash('sha1').update(`${base}${CLOUDINARY_API_SECRET}`).digest('hex');
}

function inferResourceType(value) {
  const normalized = sanitizeText(value, 20).toLowerCase();
  if (['image', 'video', 'raw', 'auto'].includes(normalized)) return normalized;
  return 'auto';
}

function cloudinaryUploadConfig() {
  return {
    enabled: cloudinaryEnabled(),
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    uploadFolder: CLOUDINARY_UPLOAD_FOLDER,
    maxUploadBytes: MAX_UPLOAD_BYTES
  };
}

async function destroyCloudinaryAsset(item) {
  if (!item?.publicId || !cloudinaryEnabled()) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const resourceType = inferResourceType(item.resourceType || 'image');
  const invalidate = 'true';
  const signature = signCloudinaryParams({
    invalidate,
    public_id: item.publicId,
    timestamp
  });

  const body = new URLSearchParams({
    public_id: item.publicId,
    timestamp: String(timestamp),
    invalidate,
    api_key: CLOUDINARY_API_KEY,
    signature
  });

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/${encodeURIComponent(resourceType)}/destroy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  if (!response.ok) {
    throw new HttpError(502, 'Failed to delete the Cloudinary asset.');
  }
}

function validateCategoryPayload(body, existingCategory) {
  const label = sanitizeText(body.label ?? existingCategory?.label, 80);
  if (!label) throw new HttpError(400, 'Category label is required.');

  const id = existingCategory?.id || sanitizeSlug(body.id || label);
  if (!id) throw new HttpError(400, 'Category ID is required.');

  const layout = sanitizeText(body.layout ?? existingCategory?.layout ?? 'packages', 20);
  if (!VALID_LAYOUTS.has(layout)) throw new HttpError(400, 'Invalid category layout.');

  return {
    id,
    label,
    icon: sanitizeText(body.icon ?? existingCategory?.icon ?? '🎬', 12),
    layout
  };
}

function validatePricingItemPayload(body, options = {}) {
  const existingItem = options.existingItem || null;
  const categories = options.categories || [];
  const categoryId = sanitizeSlug(body.categoryId ?? existingItem?.categoryId);
  if (!categoryId || !categories.some((item) => item.id === categoryId)) {
    throw new HttpError(400, 'A valid category is required.');
  }

  const name = sanitizeText(body.name ?? existingItem?.name, 120);
  if (!name) throw new HttpError(400, 'Pricing item name is required.');

  const variant = sanitizeText(body.variant ?? existingItem?.variant ?? 'package', 20);
  if (!VALID_VARIANTS.has(variant)) throw new HttpError(400, 'Invalid pricing item variant.');

  return {
    id: existingItem?.id || (body.id ? sanitizeSlug(body.id) : makeId('price')),
    categoryId,
    tier: sanitizeText(body.tier ?? existingItem?.tier, 80),
    name,
    price: sanitizeText(body.price ?? existingItem?.price, 50),
    priceNote: sanitizeText(body.priceNote ?? existingItem?.priceNote, 80),
    description: sanitizeText(body.description ?? existingItem?.description, 240),
    features: body.features !== undefined ? normalizeArray(body.features).slice(0, 24) : (existingItem?.features || []),
    ctaLabel: sanitizeText(body.ctaLabel ?? existingItem?.ctaLabel ?? 'Book This', 40),
    ctaLink: normalizeUrl(body.ctaLink ?? existingItem?.ctaLink ?? '#contact', true),
    featured: body.featured !== undefined ? Boolean(body.featured) : Boolean(existingItem?.featured),
    badge: sanitizeText(body.badge ?? existingItem?.badge, 40),
    variant
  };
}

function validateMediaPayload(body, existingItem) {
  const title = sanitizeText(body.title ?? existingItem?.title, 140);
  if (!title) throw new HttpError(400, 'Media title is required.');

  const category = sanitizeSlug(body.category ?? existingItem?.category);
  if (!category) throw new HttpError(400, 'Media category is required.');

  return {
    id: existingItem?.id || (body.id ? sanitizeSlug(body.id) : makeId('media')),
    title,
    category,
    emoji: sanitizeText(body.emoji ?? existingItem?.emoji ?? '🎬', 12),
    filename: sanitizeStoredFilename(body.filename ?? existingItem?.filename),
    externalUrl: normalizeUrl(body.externalUrl ?? existingItem?.externalUrl, false),
    resourceType: inferResourceType(body.resourceType ?? existingItem?.resourceType),
    publicId: sanitizeText(body.publicId ?? existingItem?.publicId, 200),
    featured: body.featured !== undefined ? Boolean(body.featured) : Boolean(existingItem?.featured)
  };
}

function validateInquiryPayload(body) {
  const inquiry = {
    id: makeId('inq'),
    name: sanitizeText(body.name, 120),
    phone: sanitizeText(body.phone, 30),
    email: sanitizeText(body.email, 120),
    service: sanitizeText(body.service, 120),
    date: sanitizeText(body.date, 40),
    budget: sanitizeText(body.budget, 80),
    message: sanitizeText(body.message, 2000),
    createdAt: new Date().toISOString()
  };

  if (!inquiry.name || !inquiry.phone || !inquiry.service || !inquiry.message) {
    throw new HttpError(400, 'Missing required inquiry fields.');
  }

  if (!/^[0-9+()\-\s]{7,20}$/.test(inquiry.phone)) {
    throw new HttpError(400, 'Invalid phone number.');
  }

  if (inquiry.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) {
    throw new HttpError(400, 'Invalid email address.');
  }

  return inquiry;
}

function validateRuntimeConfig() {
  if (IS_PRODUCTION && ADMIN_PASSWORD === 'admin123') {
    throw new HttpError(500, 'Set a strong ADMIN_PASSWORD in Netlify environment variables.');
  }
  if (IS_PRODUCTION && !SESSION_SECRET) {
    throw new HttpError(500, 'Set SESSION_SECRET in Netlify environment variables.');
  }
}

export async function handleApiRequest(request) {
  validateRuntimeConfig();
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: securityHeaders() });
  }

  if (pathname === '/api/content' && request.method === 'GET') {
    const content = await loadContent();
    return jsonResponse({
      pricingCategories: content.pricingCategories,
      pricingItems: content.pricingItems,
      media: content.media.map(publicMediaShape)
    });
  }

  if (pathname === '/api/media' && request.method === 'GET') {
    const content = await loadContent();
    return jsonResponse(content.media.map(publicMediaShape));
  }

  if (pathname === '/api/pricing' && request.method === 'GET') {
    const content = await loadContent();
    return jsonResponse({
      categories: content.pricingCategories,
      items: content.pricingItems
    });
  }

  if (pathname === '/api/contact' && request.method === 'POST') {
    enforceOrigin(request);
    const body = await readJsonBody(request);
    const inquiry = validateInquiryPayload(body);
    const inquiries = await loadInquiries();
    inquiries.unshift(inquiry);
    await saveInquiries(inquiries.slice(0, 2000));
    return jsonResponse({ ok: true }, 201);
  }

  if (pathname === '/api/admin/login' && request.method === 'POST') {
    enforceOrigin(request);
    const body = await readJsonBody(request);
    const username = sanitizeText(body.username, 80);
    const password = String(body.password || '');

    if (!safeCompareStrings(username, ADMIN_USERNAME) || !safeCompareStrings(password, ADMIN_PASSWORD)) {
      return jsonResponse({ error: 'Invalid credentials' }, 401);
    }

    const token = createSessionToken();
    return jsonResponse(
      { ok: true, username: ADMIN_USERNAME },
      200,
      { 'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)) }
    );
  }

  if (pathname === '/api/admin/logout' && request.method === 'POST') {
    enforceOrigin(request);
    return jsonResponse(
      { ok: true },
      200,
      { 'Set-Cookie': sessionCookie('', 0) }
    );
  }

  if (pathname === '/api/admin/session' && request.method === 'GET') {
    const session = getSessionFromRequest(request);
    return jsonResponse({ authenticated: Boolean(session), username: session?.username || null });
  }

  if (pathname === '/api/admin/content' && request.method === 'GET') {
    requireAdmin(request);
    const [content, inquiries] = await Promise.all([loadContent(), loadInquiries()]);
    return jsonResponse({
      pricingCategories: content.pricingCategories,
      pricingItems: content.pricingItems,
      media: content.media,
      inquiries,
      cloudinary: cloudinaryUploadConfig()
    });
  }

  if (pathname === '/api/admin/upload-signature' && request.method === 'POST') {
    enforceOrigin(request);
    requireAdmin(request);
    requireCloudinary();
    const body = await readJsonBody(request);
    const fileName = sanitizeText(body.fileName, 240);
    const fileSize = Number(body.fileSize || 0);
    const mimeType = sanitizeText(body.mimeType, 120).toLowerCase();

    if (!fileName) throw new HttpError(400, 'File name is required.');
    if (!Number.isFinite(fileSize) || fileSize <= 0) throw new HttpError(400, 'File size is required.');
    if (fileSize > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, `File too large. Max size is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
    }

    const extension = path.extname(fileName).toLowerCase();
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
      throw new HttpError(400, 'Unsupported file type.');
    }
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      throw new HttpError(400, 'Only image and video uploads are allowed.');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = CLOUDINARY_UPLOAD_FOLDER;
    const signature = signCloudinaryParams({ folder, timestamp });

    return jsonResponse({
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      timestamp,
      folder,
      signature,
      resourceType: 'auto'
    });
  }

  if (pathname === '/api/admin/pricing-categories' && request.method === 'POST') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const body = await readJsonBody(request);
    const nextCategory = validateCategoryPayload(body);
    if (content.pricingCategories.some((item) => item.id === nextCategory.id)) {
      return jsonResponse({ error: 'Category already exists' }, 409);
    }
    content.pricingCategories = [...content.pricingCategories, nextCategory];
    await saveContent(content);
    return jsonResponse(nextCategory, 201);
  }

  if (pathname.startsWith('/api/admin/pricing-categories/') && request.method === 'PUT') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const categoryId = decodeURIComponent(pathname.slice('/api/admin/pricing-categories/'.length));
    const existingCategory = content.pricingCategories.find((item) => item.id === categoryId);
    if (!existingCategory) throw new HttpError(404, 'Not found');

    const body = await readJsonBody(request);
    const updated = validateCategoryPayload(body, existingCategory);
    content.pricingCategories = content.pricingCategories.map((item) => (item.id === categoryId ? updated : item));
    await saveContent(content);
    return jsonResponse(updated);
  }

  if (pathname.startsWith('/api/admin/pricing-categories/') && request.method === 'DELETE') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const categoryId = decodeURIComponent(pathname.slice('/api/admin/pricing-categories/'.length));
    const existing = content.pricingCategories.length;
    content.pricingCategories = content.pricingCategories.filter((item) => item.id !== categoryId);
    content.pricingItems = content.pricingItems.filter((item) => item.categoryId !== categoryId);
    if (content.pricingCategories.length === existing) throw new HttpError(404, 'Not found');
    await saveContent(content);
    return jsonResponse({ ok: true });
  }

  if (pathname === '/api/admin/pricing-items' && request.method === 'POST') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const body = await readJsonBody(request);
    const item = validatePricingItemPayload(body, { categories: content.pricingCategories });
    if (content.pricingItems.some((existing) => existing.id === item.id)) {
      return jsonResponse({ error: 'Pricing item already exists.' }, 409);
    }
    content.pricingItems = [...content.pricingItems, item];
    await saveContent(content);
    return jsonResponse(item, 201);
  }

  if (pathname.startsWith('/api/admin/pricing-items/') && request.method === 'PUT') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const itemId = decodeURIComponent(pathname.slice('/api/admin/pricing-items/'.length));
    const existingItem = content.pricingItems.find((item) => item.id === itemId);
    if (!existingItem) throw new HttpError(404, 'Not found');
    const body = await readJsonBody(request);
    const updated = validatePricingItemPayload(body, { existingItem, categories: content.pricingCategories });
    content.pricingItems = content.pricingItems.map((item) => (item.id === itemId ? updated : item));
    await saveContent(content);
    return jsonResponse(updated);
  }

  if (pathname.startsWith('/api/admin/pricing-items/') && request.method === 'DELETE') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const itemId = decodeURIComponent(pathname.slice('/api/admin/pricing-items/'.length));
    const existing = content.pricingItems.length;
    content.pricingItems = content.pricingItems.filter((item) => item.id !== itemId);
    if (content.pricingItems.length === existing) throw new HttpError(404, 'Not found');
    await saveContent(content);
    return jsonResponse({ ok: true });
  }

  if (pathname === '/api/admin/media' && request.method === 'POST') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const body = await readJsonBody(request);
    const item = validateMediaPayload(body);
    if (content.media.some((existing) => existing.id === item.id)) {
      return jsonResponse({ error: 'Media item already exists.' }, 409);
    }
    content.media = [...content.media, item];
    await saveContent(content);
    return jsonResponse(item, 201);
  }

  if (pathname.startsWith('/api/admin/media/') && request.method === 'PUT') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const itemId = decodeURIComponent(pathname.slice('/api/admin/media/'.length));
    const existingItem = content.media.find((item) => item.id === itemId);
    if (!existingItem) throw new HttpError(404, 'Not found');
    const body = await readJsonBody(request);
    const updated = validateMediaPayload(body, existingItem);
    content.media = content.media.map((item) => (item.id === itemId ? updated : item));
    await saveContent(content);
    return jsonResponse(updated);
  }

  if (pathname.startsWith('/api/admin/media/') && request.method === 'DELETE') {
    enforceOrigin(request);
    requireAdmin(request);
    const content = await loadContent();
    const itemId = decodeURIComponent(pathname.slice('/api/admin/media/'.length));
    const removed = content.media.find((item) => item.id === itemId);
    if (!removed) throw new HttpError(404, 'Not found');
    content.media = content.media.filter((item) => item.id !== itemId);
    await saveContent(content);
    await destroyCloudinaryAsset(removed);
    return jsonResponse({ ok: true });
  }

  throw new HttpError(404, 'Not found');
}

export function handleNetlifyError(error) {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.statusCode, error.headers);
  }
  console.error(error);
  return textResponse('Internal Server Error', 500);
}

export function netlifyUploadLimitText() {
  return formatBytes(MAX_UPLOAD_BYTES);
}
