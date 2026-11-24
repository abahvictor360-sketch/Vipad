import { useEditor } from '../store/editor';

/** Ask for one audio file and insert it at the cursor of the current file. */
export function pickAndInsertFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.opus,.aif,.aiff,.au,.snd';
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void useEditor.getState().insertFile(f);
  };
  input.click();
}
