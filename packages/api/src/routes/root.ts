import { jsonResponse } from '../helpers';

export function handleRoot(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Content Vault</title>
<style>
  body { font-family: system-ui; max-width: 600px; margin: 4rem auto; padding: 0 1rem; line-height: 1.6; }
  a { color: #2563eb; }
</style>
</head>
<body>
<h1>Content Vault</h1>
<p>Public data endpoints and admin panel.</p>
<ul>
  <li><a href="/data/personal-projects.json">/data/personal-projects.json</a></li>
  <li><a href="/data/projects.json">/data/projects.json</a></li>
  <li><a href="/data/profile.json">/data/profile.json</a></li>
  <li><a href="/data/resume.json">/data/resume.json</a></li>
  <li><a href="/data/highlights.json">/data/highlights.json</a></li>
  <li><a href="/admin/">Admin panel</a></li>
  <li><a href="/api/health">API health</a></li>
</ul>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
