/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // FMP serves company logos from images.financialmodelingprep.com
    remotePatterns: [
      { protocol: "https", hostname: "images.financialmodelingprep.com" },
      { protocol: "https", hostname: "financialmodelingprep.com" },
    ],
  },
};

export default nextConfig;
