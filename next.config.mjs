/** @type {import("next").NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Autorise le hub à embarquer des apps locales en iframe.
          // Les sites externes (ChatGPT, Claude...) peuvent refuser
          // l'iframe via X-Frame-Options — le hub affichera alors
          // un bouton "Ouvrir dans un nouvel onglet".
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
