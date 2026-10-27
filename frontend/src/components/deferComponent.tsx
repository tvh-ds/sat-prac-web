import { lazy, Suspense, type Attributes, type FunctionComponent, type PropsWithRef } from "react";
import { Spinner } from "./ui";

// Keep the surrounding page mounted while an optional tool is downloaded.
export function deferComponent<P extends object>(load: () => Promise<{ default: FunctionComponent<P> }>) {
  const Component = lazy(load);
  return function DeferredComponent(props: PropsWithRef<P> & Attributes) {
    return <Suspense fallback={<Spinner />}><Component {...props} /></Suspense>;
  };
}
