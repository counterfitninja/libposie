const UA = 'Libposie/1.0 (self-hosted personal library)';
const TIMEOUT_MS = 8000;

export function normaliseIsbn(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn(isbn) {
  const v = normaliseIsbn(isbn);
  if (v.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const c = v[i];
      const n = c === 'X' ? 10 : Number(c);
      if (Number.isNaN(n)) return false;
      sum += n * (10 - i);
    }
    return sum % 11 === 0;
  }
  if (v.length === 13) {
    if (!/^\d{13}$/.test(v)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(v[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  return false;
}

async function getJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function blank() {
  return {
    title: '',
    subtitle: '',
    authors: '',
    publisher: '',
    publishedDate: '',
    isbn10: '',
    isbn13: '',
    pageCount: null,
    language: '',
    description: '',
    coverUrl: '',
    source: ''
  };
}

/* ---------------------------------------------------------------- sources */

async function googleBooks(query, isIsbn) {
  const q = isIsbn ? `isbn:${query}` : query;
  const key = process.env.GOOGLE_BOOKS_API_KEY ? `&key=${encodeURIComponent(process.env.GOOGLE_BOOKS_API_KEY)}` : '';
  const data = await getJson(
    `https://www.googleapis.com/books/v1/volumes?maxResults=10&q=${encodeURIComponent(q)}${key}`
  );
  if (!data?.items) return [];
  return data.items.map((item) => {
    const v = item.volumeInfo || {};
    const ids = v.industryIdentifiers || [];
    const cover = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '';
    return {
      ...blank(),
      title: v.title || '',
      subtitle: v.subtitle || '',
      authors: (v.authors || []).join(', '),
      publisher: v.publisher || '',
      publishedDate: v.publishedDate || '',
      isbn10: ids.find((i) => i.type === 'ISBN_10')?.identifier || '',
      isbn13: ids.find((i) => i.type === 'ISBN_13')?.identifier || '',
      pageCount: v.pageCount || null,
      language: v.language || '',
      description: v.description || '',
      coverUrl: cover.replace(/^http:/, 'https:'),
      source: 'Google Books'
    };
  });
}

async function openLibraryByIsbn(isbn) {
  const data = await getJson(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`
  );
  const entry = data?.[`ISBN:${isbn}`];
  if (!entry) return [];
  const ids = entry.identifiers || {};
  return [
    {
      ...blank(),
      title: entry.title || '',
      subtitle: entry.subtitle || '',
      authors: (entry.authors || []).map((a) => a.name).join(', '),
      publisher: (entry.publishers || []).map((p) => p.name).join(', '),
      publishedDate: entry.publish_date || '',
      isbn10: ids.isbn_10?.[0] || (isbn.length === 10 ? isbn : ''),
      isbn13: ids.isbn_13?.[0] || (isbn.length === 13 ? isbn : ''),
      pageCount: entry.number_of_pages || null,
      language: '',
      description:
        typeof entry.notes === 'string' ? entry.notes : entry.notes?.value || entry.excerpts?.[0]?.text || '',
      coverUrl: entry.cover?.large || entry.cover?.medium || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
      source: 'Open Library'
    }
  ];
}

async function openLibrarySearch(query) {
  const data = await getJson(
    `https://openlibrary.org/search.json?limit=10&q=${encodeURIComponent(query)}`
  );
  if (!data?.docs) return [];
  return data.docs.map((d) => {
    const isbn13 = (d.isbn || []).find((i) => i.length === 13) || '';
    const isbn10 = (d.isbn || []).find((i) => i.length === 10) || '';
    return {
      ...blank(),
      title: d.title || '',
      subtitle: d.subtitle || '',
      authors: (d.author_name || []).join(', '),
      publisher: (d.publisher || [])[0] || '',
      publishedDate: d.first_publish_year ? String(d.first_publish_year) : '',
      isbn10,
      isbn13,
      pageCount: d.number_of_pages_median || null,
      language: (d.language || [])[0] || '',
      description: '',
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
      source: 'Open Library'
    };
  });
}

async function isbndb(query, isIsbn) {
  const key = process.env.ISBNDB_API_KEY;
  if (!key) return [];
  const url = isIsbn
    ? `https://api2.isbndb.com/book/${encodeURIComponent(query)}`
    : `https://api2.isbndb.com/books/${encodeURIComponent(query)}?pageSize=10`;
  const data = await getJson(url, { Authorization: key });
  const books = isIsbn ? (data?.book ? [data.book] : []) : data?.books || [];
  return books.map((b) => ({
    ...blank(),
    title: b.title || '',
    subtitle: b.title_long && b.title_long !== b.title ? b.title_long : '',
    authors: (b.authors || []).join(', '),
    publisher: b.publisher || '',
    publishedDate: b.date_published || '',
    isbn10: b.isbn || '',
    isbn13: b.isbn13 || '',
    pageCount: b.pages || null,
    language: b.language || '',
    description: b.synopsis || b.overview || '',
    coverUrl: b.image || '',
    source: 'ISBNdb'
  }));
}

/* --------------------------------------------------------------- combine */

function score(c) {
  let s = 0;
  if (c.title) s += 4;
  if (c.authors) s += 3;
  if (c.coverUrl) s += 2;
  if (c.description) s += 2;
  if (c.publishedDate) s += 1;
  if (c.publisher) s += 1;
  if (c.pageCount) s += 1;
  return s;
}

/**
 * Query every configured source in parallel and return de-duplicated,
 * best-first candidates for the user to choose from.
 */
export async function lookup(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];

  const asIsbn = normaliseIsbn(trimmed);
  const isIsbn = isValidIsbn(asIsbn);
  const term = isIsbn ? asIsbn : trimmed;

  const groups = await Promise.all([
    googleBooks(term, isIsbn).catch(() => []),
    (isIsbn ? openLibraryByIsbn(term) : openLibrarySearch(term)).catch(() => []),
    isbndb(term, isIsbn).catch(() => [])
  ]);

  const seen = new Set();
  const results = [];
  for (const candidate of groups.flat()) {
    if (!candidate.title) continue;
    if (isIsbn) {
      if (asIsbn.length === 13 && !candidate.isbn13) candidate.isbn13 = asIsbn;
      if (asIsbn.length === 10 && !candidate.isbn10) candidate.isbn10 = asIsbn;
    }
    const key = `${candidate.source}|${candidate.title.toLowerCase()}|${candidate.authors.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(candidate);
  }

  return results.sort((a, b) => score(b) - score(a)).slice(0, 20);
}
