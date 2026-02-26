import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface Point {
  x: number;
  y: number;
}

export interface Dimensions {
  feet: number;
  inches: number;
}

export interface ObjectDefinition {
  id: string;
  name: string;
  width: number; // in decimal feet
  length: number; // in decimal feet
  type?: 'standard' | 'door';
}

export interface PlacedObject {
  id: string;
  definitionId: string;
  x: number; // in decimal feet
  y: number; // in decimal feet
  rotation: number; // 0, 90, 180, 270
}

export interface TempWall {
  id: string;
  start: Point; // in decimal feet
  end: Point; // in decimal feet
  color?: string;
  isDashed?: boolean;
}

export interface RoomLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  rotation?: number;
}

export interface Room {
  id: string;
  name: string;
  points: Point[]; // in decimal feet
  objects: PlacedObject[];
  tempWalls: TempWall[];
  labels?: RoomLabel[];
}

export const PIXELS_PER_FOOT = 30;
export const GRID_SIZE = 1; // 1 foot

export function formatFeetInches(decimalFeet: number): string {
  const feet = Math.floor(decimalFeet);
  const inches = Math.round((decimalFeet - feet) * 12);
  return `${feet}'${inches}"`;
}

export function parseFeetInches(str: string): number | null {
  const regex = /(\d+)'\s*(\d+)"/;
  const match = str.match(regex);
  if (match) {
    const feet = parseInt(match[1], 10);
    const inches = parseInt(match[2], 10);
    return feet + inches / 12;
  }
  // Try just feet
  const feetOnly = str.match(/(\d+)'/);
  if (feetOnly) return parseInt(feetOnly[1], 10);
  
  // Try decimal
  const decimal = parseFloat(str);
  if (!isNaN(decimal)) return decimal;

  return null;
}

export function calculatePolygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getObjectRect(obj: PlacedObject, def: ObjectDefinition) {
  const isRotated = obj.rotation === 90 || obj.rotation === 270;
  const w = isRotated ? def.length : def.width;
  const l = isRotated ? def.width : def.length;
  return {
    x: obj.x - w / 2,
    y: obj.y - l / 2,
    width: w,
    height: l
  };
}

export function checkRectOverlap(r1: any, r2: any): boolean {
  return !(r2.x >= r1.x + r1.width || 
           r2.x + r2.width <= r1.x || 
           r2.y >= r1.y + r1.height || 
           r2.y + r2.height <= r1.y);
}

export function isRectInPolygon(rect: any, polygon: Point[]): boolean {
  // Check all 4 corners
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ];
  return corners.every(p => isPointInPolygon(p, polygon));
}

export function lineIntersectRect(p1: Point, p2: Point, rect: any): boolean {
  // Simple line-rect intersection
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  // Check if either end is inside
  if (p1.x >= left && p1.x <= right && p1.y >= top && p1.y <= bottom) return true;
  if (p2.x >= left && p2.x <= right && p2.y >= top && p2.y <= bottom) return true;

  // Check intersection with 4 sides
  const lines = [
    [{ x: left, y: top }, { x: right, y: top }],
    [{ x: right, y: top }, { x: right, y: bottom }],
    [{ x: right, y: bottom }, { x: left, y: bottom }],
    [{ x: left, y: bottom }, { x: left, y: top }]
  ];

  return lines.some(l => doLinesIntersect(p1, p2, l[0], l[1]));
}

export function getLineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const det = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (det === 0) return null;
  const lambda = ((p4.y - p3.y) * (p4.x - p1.x) + (p3.x - p4.x) * (p4.y - p1.y)) / det;
  const gamma = ((p1.y - p2.y) * (p4.x - p1.x) + (p2.x - p1.x) * (p4.y - p1.y)) / det;
  if (0 <= lambda && lambda <= 1 && 0 <= gamma && gamma <= 1) {
    return {
      x: p1.x + lambda * (p2.x - p1.x),
      y: p1.y + lambda * (p2.y - p1.y)
    };
  }
  return null;
}

function doLinesIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (det === 0) return false;
  const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
  const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
  return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}
