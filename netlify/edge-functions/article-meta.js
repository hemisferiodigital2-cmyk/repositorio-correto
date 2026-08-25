const SUPABASE_URL = "https://qhofpntovhbjtwjsqgwi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_ukFS4mVWa2FNwH7p-KA3Xg_CTAcNLXw";

const DEFAULT_TITLE = "Portal Hemisfério Digital — Informação em todo lugar";
const DEFAULT_DESCRIPTION = "Hemisfério Digital: cobertura política e jornalismo independente do Amapá.";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function removeSocialMeta(html) {
  return html
    .replace(/\s*<meta\s+(?:property|name)=["'](?:og:|twitter:)[^>]*>/gi, "")
    .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, "");
}

export default async (request, context) => {
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  const encodedSlug = requestUrl.pathname
    .replace(/^\/artigo\/+/, "")
    .replace(/\/+$/, "");

  if (!encodedSlug) return;

  let slug;
  try {
    slug = decodeURIComponent(encodedSlug);
  } catch {
    slug = encodedSlug;
  }

  const apiUrl = new URL(`${SUPABASE_URL}/rest/v1/artigos`);
  apiUrl.searchParams.set(
    "select",
    "titulo,titulo_seo,resumo,linha_fina,imagem_url,imagem_alt,slug"
  );
  apiUrl.searchParams.set("slug", `eq.${slug}`);
  apiUrl.searchParams.set("limit", "1");

  try {
    const articleResponse = await fetch(apiUrl, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Accept: "application/json",
      },
    });

    if (!articleResponse.ok) return;

    const articles = await articleResponse.json();
    const article = Array.isArray(articles) ? articles[0] : null;
    if (!article) return;

    const downstream = await context.next();
    const contentType = downstream.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return downstream;

    let html = await downstream.text();

    const title = article.titulo_seo || article.titulo || DEFAULT_TITLE;
    const description = article.linha_fina || article.resumo || DEFAULT_DESCRIPTION;
    const image = article.imagem_url || "";
    const imageAlt = article.imagem_alt || article.titulo || "Capa da matéria";
    const canonicalUrl = `${requestUrl.origin}/artigo/${encodeURIComponent(article.slug || slug)}`;

    html = removeSocialMeta(html);

    html = html.replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${escapeHtml(title)} | Portal Hemisfério Digital</title>`
    );

    html = html.replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      `<meta name="description" content="${escapeHtml(description)}" />`
    );

    const socialTags = [
      `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
      `<meta property="og:type" content="article" />`,
      `<meta property="og:site_name" content="Portal Hemisfério Digital" />`,
      `<meta property="og:locale" content="pt_BR" />`,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
      image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "",
      image ? `<meta property="og:image:secure_url" content="${escapeHtml(image)}" />` : "",
      image ? `<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />` : "",
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
      image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : "",
    ].filter(Boolean).join("\n    ");

    html = html.replace("</head>", `    ${socialTags}\n  </head>`);

    return new Response(html, downstream);
  } catch (error) {
    console.error("Falha ao gerar metadados sociais do artigo:", error);
    return;
  }
};

export const config = {
  path: "/artigo/*",
};
