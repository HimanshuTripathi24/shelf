import { NextRequest, NextResponse } from "next/server";

// Source-specific Referer headers — required to bypass hotlink protection
function getReferer(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host.includes("novelfull"))    return "https://novelfull.net/";
    if (host.includes("novelcool"))    return "https://www.novelcool.com/";
    if (host.includes("novelbin"))     return "https://novelbin.com/";
    if (host.includes("novelhall"))    return "https://www.novelhall.com/";
    if (host.includes("novlove"))      return "https://novlove.com/";
    if (host.includes("allnovelfull")) return "https://allnovelfull.com/";
    return u.origin + "/";
  } catch {
    return "https://novelfull.net/";
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing URL", { status: 400 });

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return new NextResponse("Invalid URL", { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": getReferer(url),
        "Accept": "image/webp,image/avif,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return new NextResponse(`Upstream error: ${res.status}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return new NextResponse("Not an image", { status: 400 });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Image proxy error:", url, message);
    return new NextResponse("Failed to fetch image", { status: 500 });
  }
}