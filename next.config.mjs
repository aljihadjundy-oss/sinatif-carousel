/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      '/api/carousel/designer': ['./public/fonts/**'],
    },
  },
};

export default nextConfig;
