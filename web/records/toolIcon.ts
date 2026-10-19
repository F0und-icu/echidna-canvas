import { Blocks, FilePenLine, Globe, Image, Timer, Terminal, Wrench } from 'lucide-react';

export function toolIcon(tool: string) {
  switch (tool) {
    case 'codex.commandExecution':
      return Terminal;
    case 'codex.webSearch':
      return Globe;
    case 'codex.mcpToolCall':
      return Blocks;
    case 'codex.fileChange':
      return FilePenLine;
    case 'codex.imageView':
    case 'codex.imageGeneration':
      return Image;
    case 'codex.sleep':
      return Timer;
    default:
      return Wrench;
  }
}
