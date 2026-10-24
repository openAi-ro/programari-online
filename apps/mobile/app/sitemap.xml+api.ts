import { buildSitemapXml } from '@/lib/publicPageMeta';
import { listSitemapBusinesses, publicOrigin } from '@/lib/publicBusinessServer';

/** /sitemap.xml — pagina principală + paginile publice ale saloanelor active. */
export async function GET() {
  const rows = await listSitemapBusinesses();
  return new Response(buildSitemapXml(publicOrigin(), rows), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
