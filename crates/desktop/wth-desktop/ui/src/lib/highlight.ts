/**
 * Syntax highlighting registration for chat markdown fences.
 *
 * `react-syntax-highlighter`'s default `Prism` entry bundles every language
 * Prism ships (~200 grammars) and was the single largest item in the desktop
 * bundle. `PrismLight` registers nothing; we add the set an agent transcript
 * realistically contains.
 *
 * Unlisted fences are not an error: PrismLight falls back to plaintext, which
 * still renders and copies correctly (`plaintext` is the built-in default, not a
 * registerable grammar in this package). Code that needs real highlighting is
 * opened in Monaco (EditorPanel), which owns its own grammar loading.
 */
import { PrismLight } from "react-syntax-highlighter";

import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import makefile from "react-syntax-highlighter/dist/esm/languages/prism/makefile";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import scss from "react-syntax-highlighter/dist/esm/languages/prism/scss";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

const languages: Array<[string, unknown]> = [
  ["bash", bash],
  ["sh", bash],
  ["shell", bash],
  ["zsh", bash],
  ["c", c],
  ["cpp", cpp],
  ["c++", cpp],
  ["csharp", csharp],
  ["cs", csharp],
  ["css", css],
  ["scss", scss],
  ["diff", diff],
  ["docker", docker],
  ["dockerfile", docker],
  ["go", go],
  ["golang", go],
  ["graphql", graphql],
  ["ini", ini],
  ["properties", ini],
  ["java", java],
  ["javascript", javascript],
  ["js", javascript],
  ["json", json],
  ["jsonc", json],
  ["jsx", jsx],
  ["kotlin", kotlin],
  ["makefile", makefile],
  ["make", makefile],
  ["markdown", markdown],
  ["md", markdown],
  ["php", php],
  ["python", python],
  ["py", python],
  ["ruby", ruby],
  ["rb", ruby],
  ["rust", rust],
  ["rs", rust],
  ["sql", sql],
  ["swift", swift],
  ["toml", toml],
  ["typescript", typescript],
  ["ts", typescript],
  ["tsx", tsx],
  ["yaml", yaml],
  ["yml", yaml],
];

const registered = new Set<string>();

for (const [name, grammar] of languages) {
  if (registered.has(name)) continue;
  registered.add(name);
  PrismLight.registerLanguage(name, grammar as never);
}

export { PrismLight as SyntaxHighlighter };
export const registeredLanguages = registered;
