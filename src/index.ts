import { glob } from "glob";
import { existsSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { tsImport } from "tsx/esm/api";
import type { Plugin } from "vite";

export function renderTypescriptToHTMLPlugin(dir: string): Plugin {
  const cwd = process.cwd();
  const entryDir = path.join(cwd, dir);
  const prettierOptions: prettier.Options = {
    parser: "html",
    printWidth: 10_000,
    singleQuote: false,
    useTabs: true,
  };

  const renderHtml = (input: string | (() => string)) => {
    if (typeof input === "string") {
      return input;
    }

    return input();
  };

  const isPage = (filePath: string) => {
    const relativePath = path.relative(entryDir, filePath);
    return relativePath.split("/").every((part) => !part.startsWith("_"));
  };

  return {
    name: "@wirunekaewjai/vite-plugin-render-typescript-to-html",

    config(config, { command }) {
      if (command !== "build") {
        return;
      }

      const entryFiles = glob.sync("**/*.ts", { cwd: entryDir });
      const entries = Object.fromEntries(
        entryFiles
          .map((file) => {
            const { name, dir } = path.parse(file);

            return [
              path.join(dir, name),
              path.join(entryDir, dir, name + ".html"),
            ];
          })
          .filter(([_, filePath]) => isPage(filePath!)),
      );

      if (!config.build) {
        config.build = {};
      }

      if (!config.build.rollupOptions) {
        config.build.rollupOptions = {};
      }

      config.build.rollupOptions.input = entries;
    },

    configureServer(server) {
      const { middlewares, watcher, ws } = server;

      middlewares.use(async (req, res, next) => {
        let name = req.url || "/";

        if (name.includes("?")) {
          name = name.split("?")[0]!;
        }

        name = name.slice(1);

        const entryPath = path.join(entryDir, name + ".ts");

        if (existsSync(entryPath) && isPage(entryPath)) {
          const tsModule = await tsImport(entryPath, cwd);

          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html");
          res.end(renderHtml(tsModule.default));

          return;
        }

        next();
      });

      watcher.on("change", (path) => {
        if (path.startsWith(entryDir)) {
          ws.send({
            type: "full-reload",
          });
        }
      });
    },

    resolveId(id) {
      if (id.startsWith(entryDir) && isPage(id)) {
        return id;
      }
    },

    async load(id) {
      if (id.startsWith(entryDir) && isPage(id)) {
        const tsPath = id.replace(/\.html$/, ".ts");
        const tsModule = await tsImport(tsPath, cwd);

        const html = renderHtml(tsModule.default);

        return await prettier.format(html, prettierOptions);
      }
    },
  };
}
