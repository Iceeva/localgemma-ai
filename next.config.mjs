/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Ces modules ne sont utilisés que côté serveur Node.js.
  serverExternalPackages: [],
};
export default nextConfig;
