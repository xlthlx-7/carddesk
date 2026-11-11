import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException


async def extract_page(address):
    try:
        url = urlsplit(address)
        if (url.scheme not in {"http", "https"} or not url.hostname or url.username is not None
                or url.port not in {None, 80 if url.scheme == "http" else 443}):
            raise ValueError()
        host = url.hostname.encode("idna").decode("ascii")
        port = 443 if url.scheme == "https" else 80
        loop = asyncio.get_running_loop()
        records = await asyncio.wait_for(loop.getaddrinfo(host, port, type=socket.SOCK_STREAM), 5)
        ips = [ipaddress.ip_address(record[4][0]) for record in records]
        if not ips or any(not ip.is_global or ip.is_multicast for ip in ips):
            raise ValueError()
        # Connect to the checked address while preserving the TLS name and Host header.
        target = httpx.URL(address).copy_with(host=str(ips[0]))
        header = f"[{host}]" if ":" in host else host
        async def download():
            async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
                async with client.stream("GET", target, headers={"Host": header},
                                         extensions={"sni_hostname": host}) as response:
                    response.raise_for_status()
                    if "text/html" not in response.headers.get("content-type", "").lower():
                        raise ValueError()
                    content = bytearray()
                    async for chunk in response.aiter_bytes(chunk_size=16384):
                        content.extend(chunk)
                        if len(content) > 2_000_000:
                            raise ValueError()
                return content
        content = await asyncio.wait_for(download(), 18)
        soup = BeautifulSoup(bytes(content), "html.parser")
        title = soup.title.get_text(" ", strip=True) if soup.title else host
        for node in soup.select("script,style,noscript,nav,footer,aside,header,form"):
            node.decompose()
        main = soup.find("article") or soup.find("main") or soup.body or soup
        parts = [node.get_text(" ", strip=True) for node in main.find_all(["h1","h2","h3","p","li","pre","blockquote"])]
        body = "\n\n".join(part for part in parts if part) or main.get_text("\n", strip=True)
        if not body:
            raise ValueError()
        return {"title": (title or host)[:200], "body": body[:50000], "url": address}
    except (httpx.HTTPError, ValueError, OSError, asyncio.TimeoutError):
        raise HTTPException(422, "无法提取正文，请使用公开 HTML 页面的最终地址，或手动粘贴摘录")
