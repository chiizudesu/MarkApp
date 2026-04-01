import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Button, Text, VStack } from "@chakra-ui/react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      const msg = this.state.error.message;
      return (
        <Box p={8} maxW="lg" mx="auto" mt={10}>
          <VStack align="stretch" gap={4}>
            <Text fontWeight="bold" fontSize="lg">
              Something went wrong
            </Text>
            <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap">
              {msg}
            </Text>
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(msg).catch(() => {});
              }}
            >
              Copy error
            </Button>
          </VStack>
        </Box>
      );
    }
    return this.props.children;
  }
}
