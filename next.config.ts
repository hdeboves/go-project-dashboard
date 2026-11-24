import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "exceljs"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
