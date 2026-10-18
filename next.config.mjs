/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Ces modules ne sont utilisés que côté serveur Node.js.
  serverExternalPackages: ["pdfkit", "exceljs", "pptxgenjs", "mammoth", "unpdf", "docx"],
};
export default nextConfig;
