import { createElement } from "react";
// Next's image bundler interop is outside this isolated render test.
export default function Image({ priority, ...props }) {
  void priority;
  return createElement("img", props);
}
