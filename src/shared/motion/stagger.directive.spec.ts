import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { StaggerDirective } from './stagger.directive';

@Component({
  imports: [StaggerDirective],
  template: `<div appStagger><span>a</span><span>b</span></div>`,
})
class HostCmp {}

describe('StaggerDirective (DL-03)', () => {
  afterEach(() => {
    document.documentElement.classList.remove('motion-reduced');
  });

  it('suelta `animation` al terminar la animación (animationend) y el estado final no cambia', () => {
    const fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    const children = Array.from(fixture.nativeElement.querySelectorAll('span')) as HTMLElement[];
    expect(children[0].style.animation).toContain('mv-stagger-in');

    children.forEach((el) => el.dispatchEvent(new Event('animationend')));

    children.forEach((el) => expect(el.style.animation).toBe(''));
  });

  it('red de seguridad: sin `animationend`, el temporizador limpia el estilo igual', () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    const children = Array.from(fixture.nativeElement.querySelectorAll('span')) as HTMLElement[];

    vi.advanceTimersByTime(5000);

    children.forEach((el) => expect(el.style.animation).toBe(''));
    vi.useRealTimers();
  });

  it('con movimiento reducido no aplica ninguna animación inline', () => {
    document.documentElement.classList.add('motion-reduced');
    const fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
    const children = Array.from(fixture.nativeElement.querySelectorAll('span')) as HTMLElement[];
    children.forEach((el) => expect(el.style.animation).toBe(''));
  });
});
