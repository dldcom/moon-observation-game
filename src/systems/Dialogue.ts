export class Dialogue {
  private readonly textElement = this.getElement('#dialogue-text');
  private readonly hintElement = this.getElement('#tap-hint');
  private readonly progressElement = this.getElement('#dialogue-progress');

  private fullText = '';
  private visibleCharacters = 0;
  private characterCarry = 0;
  private typing = false;

  start(text: string, index: number, total: number): void {
    this.fullText = text;
    this.visibleCharacters = 0;
    this.characterCarry = 0;
    this.typing = true;
    this.textElement.textContent = '';
    this.progressElement.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    this.hintElement.textContent = '화면을 탭하면 문장이 완성돼';
  }

  update(delta: number): void {
    if (!this.typing) return;

    // Korean narration reads comfortably at roughly 34 characters per second.
    this.characterCarry += delta * 34;
    const nextCharacters = Math.min(this.fullText.length, Math.floor(this.characterCarry));
    if (nextCharacters === this.visibleCharacters) return;

    this.visibleCharacters = nextCharacters;
    this.textElement.textContent = this.fullText.slice(0, this.visibleCharacters);
    if (this.visibleCharacters >= this.fullText.length) {
      this.finish();
    }
  }

  finish(): void {
    this.visibleCharacters = this.fullText.length;
    this.characterCarry = this.fullText.length;
    this.textElement.textContent = this.fullText;
    this.typing = false;
    this.hintElement.textContent = '화면을 탭하면 다음 이야기';
  }

  isTyping(): boolean {
    return this.typing;
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing dialogue element: ${selector}`);
    return element;
  }
}
