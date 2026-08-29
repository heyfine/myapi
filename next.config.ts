import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16.3 起 dev 模式默认阻止跨源访问开发资源；
  // localhost 与 127.0.0.1 被视为不同源，两个地址都要放行，否则从 127.0.0.1 访问时 JS 无法加载
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;

