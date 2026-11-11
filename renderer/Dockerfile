# Browsers are preinstalled in the Playwright image; the npm package version must match the image tag.
FROM mcr.microsoft.com/playwright:v1.48.2-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./
USER pwuser
EXPOSE 3001
CMD ["node", "server.js"]
