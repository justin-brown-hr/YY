import * as cheerio from 'cheerio';

export function extractNodeStateKey(url: string): string | undefined {
  const m = url.match(/nodeStateKey=([^&]+)/);
  return m?.[1];
}

export function extractNodeStateKeyFromHtml(html: string): string | undefined {
  const $ = cheerio.load(html);
  const form = $('form[action*="nodeStateKey"]');
  const action = form.attr('action');
  if (action) return extractNodeStateKey(action);
  const link = $('a[href*="nodeStateKey"]').first().attr('href');
  if (link) return extractNodeStateKey(link);
  const hidden = $('input[name="nodeStateKey"]').val();
  if (typeof hidden === 'string') return hidden;
  const m = html.match(/nodeStateKey=([A-Za-z0-9]+)/);
  return m?.[1];
}

export function parseHiddenFormFields(html: string, formSelector?: string): Record<string, string> {
  const $ = cheerio.load(html);
  const form = formSelector ? $(formSelector).first() : $('form').first();
  const fields: Record<string, string> = {};
  form.find('input').each((_, el) => {
    const name = $(el).attr('name');
    const type = ($(el).attr('type') || 'text').toLowerCase();
    if (!name || type === 'submit' || type === 'button' || type === 'image') return;
    fields[name] = $(el).attr('value') ?? '';
  });
  form.find('select').each((_, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    const selected = $(el).find('option[selected]').attr('value');
    const first = $(el).find('option').first().attr('value');
    fields[name] = selected ?? first ?? '';
  });
  return fields;
}

export function findFormAction(html: string, contains?: string): string | undefined {
  const $ = cheerio.load(html);
  const forms = $('form');
  for (let i = 0; i < forms.length; i++) {
    const action = $(forms[i]).attr('action');
    if (!action) continue;
    if (!contains || action.includes(contains)) return action;
  }
  return forms.first().attr('action') ?? undefined;
}

export function resolveUrl(base: string, path: string): string {
  if (path.startsWith('http')) return path;
  const u = new URL(base);
  if (path.startsWith('/')) return `${u.origin}${path}`;
  const dir = base.replace(/\/[^/]*$/, '/');
  return new URL(path, dir).href;
}

export function isLoggedInHtml(html: string): boolean {
  return (
    html.includes('ログアウト') ||
    html.includes('mypage') ||
    html.includes('memberId') ||
    /member\/index\.html/.test(html)
  );
}

export function isOrderCompleteHtml(html: string): boolean {
  return (
    html.includes('ご注文ありがとう') ||
    html.includes('order/complete') ||
    html.includes('注文番号')
  );
}
