import { downloadAndExtractArchive } from "./tools/downloadAndExtractArchive";
import {
    join as pathJoin,
    relative as pathRelative,
    basename as pathBasename,
    dirname as pathDirname
} from "path";
import { getThisCodebaseRootDirPath } from "./tools/getThisCodebaseRootDirPath";
import { getProxyFetchOptions } from "./tools/fetchProxyOptions";
import { transformCodebase } from "./tools/transformCodebase";
import { assert, is, type Equals } from "tsafe/assert";
import * as fs from "fs";
import chalk from "chalk";
import { id } from "tsafe/id";
import { z } from "zod";

(async () => {
    const { parsedPackageJson } = (() => {
        type ParsedPackageJson = {
            name: string;
            version: string;
            repository: Record<string, unknown>;
            license: string;
            author: string;
            homepage: string;
            keywords: string[];
        };

        const zParsedPackageJson = (() => {
            type TargetType = ParsedPackageJson;

            const zTargetType = z.object({
                name: z.string(),
                version: z.string(),
                repository: z.record(z.unknown()),
                license: z.string(),
                author: z.string(),
                homepage: z.string(),
                keywords: z.array(z.string())
            });

            type InferredType = z.infer<typeof zTargetType>;

            assert<Equals<ParsedPackageJson, InferredType>>;

            return id<z.ZodType<TargetType>>(zTargetType);
        })();

        assert<Equals<z.TypeOf<typeof zParsedPackageJson>, ParsedPackageJson>>;

        const parsedPackageJson = JSON.parse(
            fs.readFileSync(pathJoin(getThisCodebaseRootDirPath(), "package.json")).toString("utf8")
        );

        zParsedPackageJson.parse(parsedPackageJson);

        assert(is<ParsedPackageJson>(parsedPackageJson));

        return { parsedPackageJson };
    })();

    const keycloakVersion = (() => {
        const major = parsedPackageJson.version.split(".")[0];

        return `${parseInt(major[0] + major[1])}.${parseInt(major[2] + major[3])}.${parseInt(major[4] + major[5])}`;
    })();

    const { extractedDirPath } = await downloadAndExtractArchive({
        url: `https://repo1.maven.org/maven2/org/keycloak/keycloak-themes/${keycloakVersion}/keycloak-themes-${keycloakVersion}.jar`,
        cacheDirPath: pathJoin(getThisCodebaseRootDirPath(), "node_modules", ".cache", "scripts"),
        fetchOptions: getProxyFetchOptions({
            npmConfigGetCwd: getThisCodebaseRootDirPath()
        }),
        uniqueIdOfOnArchiveFile: "extract_email_theme",
        onArchiveFile: async ({ fileRelativePath, writeFile }) => {
            const fileRelativePath_target = pathRelative(
                pathJoin("theme", "base", "email"),
                fileRelativePath
            );

            if (fileRelativePath_target.startsWith("..")) {
                return;
            }

            await writeFile({ fileRelativePath: fileRelativePath_target });
        }
    });

    const distDirPath = pathJoin(getThisCodebaseRootDirPath(), "dist");

    transformCodebase({
        srcDirPath: extractedDirPath,
        destDirPath: pathJoin(distDirPath, "keycloak-theme", "email"),
        transformSourceCode: ({ fileRelativePath, sourceCode }) => {
            add_comment_to_messages_properties_file: {
                if (pathDirname(fileRelativePath) !== "messages") {
                    break add_comment_to_messages_properties_file;
                }

                const basename = pathBasename(fileRelativePath);

                if (!basename.endsWith(".properties")) {
                    break add_comment_to_messages_properties_file;
                }

                const locale = (() => {
                    const match = basename.match(/^messages_([^.]+)\.properties$/);

                    assert(match !== null);

                    return match[1];
                })();

                return {
                    modifiedSourceCode: Buffer.from(
                        [
                            `# IMPORTANT: This file contains the base translation. Modifying it directly is not recommended.`,
                            `# To override or add custom messages, create a file named messages_${locale}_override.properties in the same directory.`,
                            `# This file will be automatically loaded and merged with the base translation.`,
                            `# If you're implementing theme variants, you can also create variant-specific \`.properties\` files.`,
                            `# For example let's say you have defined \`themeName: ["vanilla", "chocolate"]\` then you can create the following files:`,
                            `# messages_${locale}_override_vanilla.properties`,
                            `# messages_${locale}_override_chocolate.properties`,
                            "",
                            sourceCode.toString("utf8")
                        ].join("\n"),
                        "utf8"
                    )
                };
            }

            return { modifiedSourceCode: sourceCode };
        }
    });

    fs.writeFileSync(
        pathJoin(distDirPath, "package.json"),
        Buffer.from(
            JSON.stringify(
                {
                    name: parsedPackageJson.name,
                    version: parsedPackageJson.version,
                    repository: parsedPackageJson.repository,
                    license: parsedPackageJson.license,
                    author: parsedPackageJson.author,
                    homepage: parsedPackageJson.homepage,
                    keywords: parsedPackageJson.keywords,
                    publishConfig: {
                        access: "public"
                    }
                },
                null,
                2
            ),
            "utf8"
        )
    );

    for (const fileBasename of ["README.md", "LICENSE"] as const) {
        fs.cpSync(
            pathJoin(getThisCodebaseRootDirPath(), fileBasename),
            pathJoin(distDirPath, fileBasename)
        );
    }

    console.log(chalk.green(`\n\nDone for keycloak version ${keycloakVersion}`));
})();
