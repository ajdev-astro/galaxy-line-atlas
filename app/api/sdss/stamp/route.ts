import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const ra = Number(request.nextUrl.searchParams.get("ra"));
  const dec = Number(request.nextUrl.searchParams.get("dec"));
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
    return new Response("Invalid coordinates", { status: 400 });
  }

  const params = new URLSearchParams({
    ra: String(ra),
    dec: String(dec),
    scale: "0.25",
    width: "420",
    height: "420",
    opt: "",
  });
  const upstream = await fetch(
    `https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg?${params}`,
    { cf: { cacheTtl: 86400 } } as RequestInit,
  );

  if (!upstream.ok) {
    return new Response("SDSS image unavailable", { status: 502 });
  }

  return new Response(await upstream.arrayBuffer(), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}

