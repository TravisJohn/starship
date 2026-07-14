import { app, ipcMain } from "electron";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export type LoadingMediaUrls = {
  animationUrl: string;
  posterUrl: string;
};

type AssetRoute = {
  fileName: string;
  contentType: string;
};

const assetRoutes: Record<string, AssetRoute> = {
  "/loading-animation.mp4": {
    fileName: "starship animation-1.mp4",
    contentType: "video/mp4"
  },
  "/loading-poster.png": {
    fileName: "starship.png",
    contentType: "image/png"
  }
};

export type BrandAssetServer = {
  getLoadingMediaUrls: () => LoadingMediaUrls;
  close: () => void;
};

export const startBrandAssetServer = async (): Promise<BrandAssetServer> => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const route = assetRoutes[url.pathname];

    if (!route) {
      response.writeHead(404);
      response.end();
      return;
    }

    const filePath = resolveBrandAssetPath(route.fileName);
    if (!filePath) {
      response.writeHead(404);
      response.end();
      return;
    }

    serveFile(request, response, filePath, route.contentType);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start brand asset server");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const getUrl = (routePath: string): string => {
    const route = assetRoutes[routePath];
    const filePath = route ? resolveBrandAssetPath(route.fileName) : null;
    const version = filePath ? fs.statSync(filePath).mtimeMs.toString(36) : Date.now().toString(36);
    return `${baseUrl}${routePath}?v=${encodeURIComponent(version)}`;
  };

  return {
    getLoadingMediaUrls: () => ({
      animationUrl: getUrl("/loading-animation.mp4"),
      posterUrl: getUrl("/loading-poster.png")
    }),
    close: () => server.close()
  };
};

export const registerBrandAssetHandlers = (assets: BrandAssetServer): void => {
  ipcMain.handle("assets:getLoadingMedia", () => assets.getLoadingMediaUrls());
};

const resolveBrandAssetPath = (fileName: string): string | null => {
  const candidates = [
    path.join(app.getAppPath(), "brand", fileName),
    path.join(process.cwd(), "brand", fileName)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const serveFile = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  filePath: string,
  contentType: string
): void => {
  const stats = fs.statSync(filePath);
  const range = request.headers.range;
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Type": contentType
  };

  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : stats.size - 1;

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end >= stats.size ||
      start > end
    ) {
      response.writeHead(416, {
        ...commonHeaders,
        "Content-Range": `bytes */${stats.size}`
      });
      response.end();
      return;
    }

    response.writeHead(206, {
      ...commonHeaders,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${stats.size}`
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    ...commonHeaders,
    "Content-Length": stats.size
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(filePath).pipe(response);
};
