#!/usr/bin/env python3
"""
One-time conversion of existing public images (R2 bucket programari-media) to WebP.

Safe by design:
  * originals are NEVER deleted or overwritten; WebP copies get NEW keys (<same folder>/<stem>.webp);
  * every DB change is written to a mapping file (old URL -> new URL) for rollback;
  * DB updates run as ONE transaction, and only for URLs whose WebP copy was verified (200, image/webp, decodes).

Steps (each one is separate; only `plan` is read-only on our side):
  1. Export rows (read-only SQL, see ROWS_SQL below) to rows.json.
  2. python3 media-webp-convert.py plan    --rows rows.json --out work/       # dry run: downloads, converts locally, reports sizes
  3. upload work/files/* to R2 under the keys in work/plan.json (Cloudflare R2 API; needs an R2 write token)
  4. python3 media-webp-convert.py verify  --plan work/plan.json              # each new URL: 200 + image/webp + decodes
  5. python3 media-webp-convert.py sql     --plan work/plan.json > update.sql # one transaction (+ rollback.sql next to it)
  6. run update.sql, then `verify-all` on the fresh rows export.

Running steps 3, 5 (applying) and 6 on the live project needs Rafael's OK.

Max long side: avatars/logos/staff photos 512 px, everything else 1200 px; WebP quality 80.
An image is skipped when it is not ours (not under MEDIA_BASE/m/), is already WebP and small enough,
or when the WebP copy would not be smaller.
"""
import argparse
import io
import json
import os
import sys
import urllib.request

from PIL import Image, ImageOps

MEDIA_BASE = 'https://programari-media.rafaeldanescu.workers.dev/m/'
QUALITY = 80
MAX_SIDE = {
    ('profiles', 'avatar_url'): 512,
    ('business_profiles', 'logo_url'): 512,
    ('staff', 'photo_url'): 512,
    ('business_profiles', 'cover_url'): 1200,
    ('business_profiles', 'gallery_urls'): 1200,
    ('staff', 'portfolio_urls'): 1200,
    ('services', 'image_url'): 1200,
}

# Read-only export; one row per (table, id, column, url). Arrays are unnested with their position.
ROWS_SQL = """
select 'profiles' t, id, 'avatar_url' c, null::int pos, avatar_url url from public.profiles where avatar_url like 'https://programari-media.%'
union all select 'business_profiles', id, 'logo_url', null, logo_url from public.business_profiles where logo_url like 'https://programari-media.%'
union all select 'business_profiles', id, 'cover_url', null, cover_url from public.business_profiles where cover_url like 'https://programari-media.%'
union all select 'business_profiles', b.id, 'gallery_urls', g.pos::int, g.u from public.business_profiles b, unnest(b.gallery_urls) with ordinality g(u, pos) where g.u like 'https://programari-media.%'
union all select 'staff', id, 'photo_url', null, photo_url from public.staff where photo_url like 'https://programari-media.%'
union all select 'staff', s.id, 'portfolio_urls', p.pos::int, p.u from public.staff s, unnest(s.portfolio_urls) with ordinality p(u, pos) where p.u like 'https://programari-media.%'
union all select 'services', id, 'image_url', null, image_url from public.services where image_url like 'https://programari-media.%'
"""


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'programari-webp-convert'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get('content-type', ''), r.read()


def new_key(url):
    key = url[len(MEDIA_BASE):].split('?')[0]
    folder, _, name = key.rpartition('/')
    stem = name.rsplit('.', 1)[0]
    return key, f'{folder}/{stem}.webp'


def convert(data, max_side):
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    if max(w, h) > max_side:
        k = max_side / max(w, h)
        img = img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    if img.mode not in ('RGB', 'RGBA'):
        img = img.convert('RGBA' if 'A' in img.getbands() or img.mode == 'P' else 'RGB')
    out = io.BytesIO()
    img.save(out, 'WEBP', quality=QUALITY, method=6)
    return out.getvalue(), (w, h), img.size


def cmd_plan(args):
    rows = json.load(open(args.rows, encoding='utf8'))
    os.makedirs(os.path.join(args.out, 'files'), exist_ok=True)
    by_url = {}
    for r in rows:
        by_url.setdefault(r['url'], []).append(r)
    items, skipped = [], []
    for url, refs in by_url.items():
        if not url.startswith(MEDIA_BASE):
            skipped.append({'url': url, 'reason': 'not_ours'}); continue
        max_side = min(MAX_SIDE.get((r['t'], r['c']), 1200) for r in refs)
        try:
            status, ctype, data = fetch(url)
        except Exception as e:  # noqa: BLE001
            skipped.append({'url': url, 'reason': f'download_failed:{e}'}); continue
        if status != 200 or not ctype.startswith('image/'):
            skipped.append({'url': url, 'reason': f'not_image:{status}:{ctype}'}); continue
        try:
            webp, before, after = convert(data, max_side)
        except Exception as e:  # noqa: BLE001
            skipped.append({'url': url, 'reason': f'decode_failed:{e}'}); continue
        old_key, key = new_key(url)
        if ctype == 'image/webp' and before == after:
            skipped.append({'url': url, 'reason': 'already_webp'}); continue
        if len(webp) >= len(data):
            skipped.append({'url': url, 'reason': 'not_smaller', 'bytes': len(data)}); continue
        fname = key.replace('/', '__')
        open(os.path.join(args.out, 'files', fname), 'wb').write(webp)
        items.append({
            'old_url': url, 'new_url': MEDIA_BASE + key, 'old_key': old_key, 'new_key': key, 'file': fname,
            'bytes_before': len(data), 'bytes_after': len(webp), 'size_before': before, 'size_after': after,
            'type_before': ctype, 'refs': [{k: r[k] for k in ('t', 'id', 'c', 'pos')} for r in refs],
        })
    plan = {'items': items, 'skipped': skipped,
            'bytes_before': sum(i['bytes_before'] for i in items), 'bytes_after': sum(i['bytes_after'] for i in items)}
    json.dump(plan, open(os.path.join(args.out, 'plan.json'), 'w', encoding='utf8'), indent=1)
    print(json.dumps({'convert': len(items), 'skipped': len(skipped), 'bytes_before': plan['bytes_before'],
                      'bytes_after': plan['bytes_after']}, indent=1))


def cmd_verify(args):
    plan = json.load(open(args.plan, encoding='utf8'))
    bad = 0
    for i in plan['items']:
        try:
            status, ctype, data = fetch(i['new_url'])
            Image.open(io.BytesIO(data)).verify()
            ok = status == 200 and ctype.startswith('image/webp') and len(data) == i['bytes_after']
        except Exception:  # noqa: BLE001
            ok = False
        i['verified'] = ok
        bad += 0 if ok else 1
    json.dump(plan, open(args.plan, 'w', encoding='utf8'), indent=1)
    print(json.dumps({'verified': len(plan['items']) - bad, 'failed': bad}))
    sys.exit(1 if bad else 0)


def q(s):
    return "'" + s.replace("'", "''") + "'"


def cmd_sql(args):
    plan = json.load(open(args.plan, encoding='utf8'))
    fwd, back = ['begin;'], ['begin;']
    for i in plan['items']:
        if not i.get('verified'):
            continue
        for r in i['refs']:
            t, c, rid = r['t'], r['c'], q(r['id'])
            if c.endswith('_urls'):
                fwd.append(f"update public.{t} set {c} = array_replace({c}, {q(i['old_url'])}, {q(i['new_url'])}) where id = {rid};")
                back.append(f"update public.{t} set {c} = array_replace({c}, {q(i['new_url'])}, {q(i['old_url'])}) where id = {rid};")
            else:
                fwd.append(f"update public.{t} set {c} = {q(i['new_url'])} where id = {rid} and {c} = {q(i['old_url'])};")
                back.append(f"update public.{t} set {c} = {q(i['old_url'])} where id = {rid} and {c} = {q(i['new_url'])};")
    fwd.append('commit;'); back.append('commit;')
    open(os.path.join(os.path.dirname(args.plan), 'rollback.sql'), 'w', encoding='utf8').write('\n'.join(back) + '\n')
    print('\n'.join(fwd))


def cmd_verify_all(args):
    rows = json.load(open(args.rows, encoding='utf8'))
    bad = []
    for url in sorted({r['url'] for r in rows}):
        try:
            status, ctype, _ = fetch(url)
            if status != 200:
                bad.append((url, status))
        except Exception as e:  # noqa: BLE001
            bad.append((url, str(e)))
    print(json.dumps({'checked': len({r['url'] for r in rows}), 'bad': bad}, indent=1))
    sys.exit(1 if bad else 0)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    a = sub.add_parser('plan'); a.add_argument('--rows', required=True); a.add_argument('--out', required=True)
    a = sub.add_parser('verify'); a.add_argument('--plan', required=True)
    a = sub.add_parser('sql'); a.add_argument('--plan', required=True)
    a = sub.add_parser('verify-all'); a.add_argument('--rows', required=True)
    sub.add_parser('rows-sql')
    args = p.parse_args()
    if args.cmd == 'rows-sql':
        print(ROWS_SQL)
        return
    {'plan': cmd_plan, 'verify': cmd_verify, 'sql': cmd_sql, 'verify-all': cmd_verify_all}[args.cmd](args)


if __name__ == '__main__':
    main()
