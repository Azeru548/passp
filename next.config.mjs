/** @type {import('next').NextConfig} */
const nextConfig = {
  // There is no backend: background removal runs in the browser. Building as a
  // static export emits a plain `out/` folder that any static host can serve
  // (Render Static Site, Cloudflare Pages, Netlify, Vercel, GitHub Pages).
  output: "export",
  reactStrictMode: true
};

export default nextConfig;
