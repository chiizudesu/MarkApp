"use client";

import { Portal, Stack, Spinner } from "@chakra-ui/react";
import {
  Toaster as ChakraToaster,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastCloseTrigger,
  ToastIndicator,
  createToaster,
} from "@chakra-ui/react";

export const toaster = createToaster({
  placement: "bottom-end",
  pauseOnPageIdle: true,
  duration: 4000,
});

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: "4" }}>
        {(toast) => (
          <ToastRoot width={{ md: "sm" }}>
            {toast.type === "loading" ? (
              <Spinner size="sm" />
            ) : (
              <ToastIndicator />
            )}
            <Stack gap="1" flex="1" maxW="100%">
              {toast.title != null && <ToastTitle>{toast.title}</ToastTitle>}
              {toast.description != null && <ToastDescription>{toast.description}</ToastDescription>}
            </Stack>
            {toast.closable !== false && <ToastCloseTrigger />}
          </ToastRoot>
        )}
      </ChakraToaster>
    </Portal>
  );
}
