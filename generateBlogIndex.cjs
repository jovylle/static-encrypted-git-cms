const fs = require('fs');
const path = require('path');

const blogsDir = path.join(__dirname, 'public', 'data', 'blogs');
const indexFile = path.join(blogsDir, 'index.json');

function parseFrontmatter(markdown) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = (markdown || '').match(frontmatterRegex);
  if (!match) return {};

  const frontmatter = {};
  match[1].split('\n').forEach((line) => {
    const colonIndex = line.indexOf(':');
    if (colonIndex <= 0) return;
    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    frontmatter[key] = value;
  });
  return frontmatter;
}

if (!fs.existsSync(blogsDir)) {
  console.warn('[warn] public/data/blogs/ not found — run npm run data:export first');
  process.exit(0);
}

const files = fs
  .readdirSync(blogsDir)
  .filter((f) => f.endsWith('.json') && f !== 'index.json');

const blogList = files.map((filename) => {
  const filePath = path.join(blogsDir, filename);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const { frontmatter } = (() => {
      const fm = parseFrontmatter(data.body || '');
      return { frontmatter: fm };
    })();
    const slug = filename.replace(/\.json$/, '');
    return {
      slug,
      title: data.title || frontmatter.title || '',
      status: data.status || 'published',
      private: data.private === true,
      date: data.date || frontmatter.date || '',
    };
  } catch (e) {
    console.warn(`[warn] Error processing ${filename}:`, e.message);
    return {
      slug: filename.replace(/\.json$/, ''),
      title: '',
      status: 'published',
      private: false,
      date: '',
    };
  }
});

blogList.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
fs.writeFileSync(indexFile, JSON.stringify(blogList, null, 2) + '\n');
console.log('Blog index generated:', indexFile);
