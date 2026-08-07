/** @type {import('next').NextConfig} */

// Static export, matching the deployment pattern already used for the
// homes-by-kishan preview site (GitHub Pages, no Node server at runtime).
//
// BASE_PATH is set when the site is served from a subdirectory, e.g. a
// GitHub Pages project site at /syon-safety-preview. Leave it unset for
// deployment at the domain root (syonsafety.com), which is the intended
// production target.
const basePath = process.env.BASE_PATH ?? '';

const nextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: {
    // next/image optimisation requires a server; static export needs this off.
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
