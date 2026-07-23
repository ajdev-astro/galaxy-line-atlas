import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    return new Response("Invalid spectrum id", { status: 400 });
  }

  const upstream = await fetch(
    `https://skyserver.sdss.org/dr18/en/get/SpecById.ashx?id=${id}`,
    { cf: { cacheTtl: 86400 } } as RequestInit,
  );

  if (!upstream.ok) {
    return new Response("SDSS spectrum unavailable", { status: 502 });
  }

  return new Response(await upstream.arrayBuffer(), {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}

