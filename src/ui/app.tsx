import { Box, Text, useApp, useInput } from 'ink';
import { panel } from '../agents/panel.js';

export function App() {
  const { exit } = useApp();

  useInput((input) => {
    if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold>THE IDIOTS</Text>
      <Text>Four perspectives. One discussion. Your decision.</Text>
      <Box flexDirection="column">
        {panel.map((agent) => (
          <Text key={agent.id} color={agent.id}>
            {agent.name} — {agent.perspective}
          </Text>
        ))}
      </Box>
      <Text>
        Development shell — discussion and model access are not wired up yet.
      </Text>
      <Text dimColor>q or Ctrl+C to quit</Text>
    </Box>
  );
}
