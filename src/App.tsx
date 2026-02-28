import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Room, 
  ObjectDefinition, 
  PIXELS_PER_FOOT, 
  GRID_SIZE, 
  formatFeetInches, 
  calculatePolygonArea,
  PlacedObject,
  TempWall,
  Point
} from './utils';
import { 
  Plus, 
  Trash2, 
  Copy, 
  FileJson, 
  Upload, 
  Download, 
  Grid3X3, 
  Square, 
  MousePointer2, 
  MousePointerSquareDashed,
  PenTool,
  RotateCw,
  Info,
  ChevronRight,
  ChevronLeft,
  Layout,
  FileText,
  Undo2,
  Redo2,
  ArrowRight,
  ArrowDown,
  Move,
  Lock,
  Unlock,
  Ruler,
  BoxSelect,
  Type,
  DoorOpen
} from 'lucide-react';
import { Stage, Layer, Line, Rect, Circle, Group, Text, Arc } from 'react-konva';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'motion/react';
import { cn, getObjectRect, checkRectOverlap, isRectInPolygon, lineIntersectRect, parseFeetInches, getLineIntersection } from './utils';

const STORAGE_KEY = 'floorplanly_data';

export default function App() {
  const [rooms, setRoomsState] = useState<Room[]>([]);
  const [history, setHistory] = useState<Room[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const addToHistory = useCallback((newRooms: Room[]) => {
    setHistory(prev => {
      const nextHistory = prev.slice(0, historyIndex + 1);
      nextHistory.push(newRooms);
      if (nextHistory.length > 50) nextHistory.shift();
      return nextHistory;
    });
    setHistoryIndex(prev => {
      const nextIndex = prev + 1;
      return nextIndex > 49 ? 49 : nextIndex;
    });
  }, [historyIndex]);

  const setRooms = useCallback((newRooms: Room[] | ((prev: Room[]) => Room[]), saveToHistory = true) => {
    setRoomsState((prev) => {
      const next = typeof newRooms === 'function' ? newRooms(prev) : newRooms;
      if (saveToHistory) {
        addToHistory(next);
      }
      return next;
    });
  }, [addToHistory]);

  const undo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setRoomsState(history[prevIndex]);
      setHistoryIndex(prevIndex);
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setRoomsState(history[nextIndex]);
      setHistoryIndex(nextIndex);
    }
  };

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [objectLibrary, setObjectLibrary] = useState<ObjectDefinition[]>([]);
  const [mode, setMode] = useState<'select' | 'move' | 'draw-room' | 'draw-wall' | 'place-object' | 'measure-line' | 'measure-rect' | 'add-text' | 'multi-select'>('select');
  const [viewLocked, setViewLocked] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 100, y: 100 });
  
  // Wall Builder State
  const [wallFeet, setWallFeet] = useState<string>("5");
  const [wallInches, setWallInches] = useState<string>("0");
  const [wallOrientation, setWallOrientation] = useState<'h' | 'v'>('h');
  const [wallColor, setWallColor] = useState('#4f46e5');
  const [wallStyle, setWallStyle] = useState<'solid' | 'dotted'>('solid');
  const [showColorPicker, setShowColorPicker] = useState(false);

  const WALL_COLORS = [
    '#4f46e5', // Indigo
    '#ef4444', // Red
    '#22c55e', // Green
    '#f59e0b', // Amber
    '#06b6d4', // Cyan
    '#ec4899', // Pink
    '#8b5cf6', // Violet
    '#71717a', // Zinc
    '#18181b', // Black
    '#94a3b8', // Gray
  ];
  
  // Drawing states
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [tempWallStart, setTempWallStart] = useState<Point | null>(null);
  const [measureStart, setMeasureStart] = useState<Point | null>(null);
  const [measureEnd, setMeasureEnd] = useState<Point | null>(null);
  const [selectionStart, setSelectionStart] = useState<Point | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<Point | null>(null);
  const [draggedObject, setDraggedObject] = useState<ObjectDefinition | null>(null);
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [hoveredWall, setHoveredWall] = useState<{ start: Point, end: Point } | null>(null);
  const [showBulkInput, setShowBulkInput] = useState(false);
  const [bulkInputText, setBulkInputText] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [pendingTextPos, setPendingTextPos] = useState<Point | null>(null);
  const [newText, setNewText] = useState("");
  
  // Manual Item State
  const [newItemName, setNewItemName] = useState("");
  const [newItemLFeet, setNewItemLFeet] = useState("4");
  const [newItemLInches, setNewItemLInches] = useState("0");
  const [newItemWFeet, setNewItemWFeet] = useState("3");
  const [newItemWInches, setNewItemWInches] = useState("4");

  const activeRoom = rooms.find(r => r.id === activeRoomId) || null;

  // Persistence and Sync Refresh
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    let initialLibrary: ObjectDefinition[] = [];
    let initialRooms: Room[] = [];

    if (saved) {
      try {
        const data = JSON.parse(saved);
        initialRooms = data.rooms || [];
        initialLibrary = data.library || [];
      } catch (e) {
        console.error("Failed to load data", e);
      }
    }

    // Ensure default door is in library
    const hasDoor = initialLibrary.some(obj => obj.type === 'door');
    if (!hasDoor) {
      initialLibrary.push({
        id: 'default-door',
        name: 'Standard Door',
        width: 3,
        length: 3,
        type: 'door'
      });
    }

    setRoomsState(initialRooms);
    setObjectLibrary(initialLibrary);
    if (initialRooms.length > 0) setActiveRoomId(initialRooms[0].id);
    
    // Initialize history
    setHistory([initialRooms]);
    setHistoryIndex(0);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rooms, library: objectLibrary }));
  }, [rooms, objectLibrary]);

  useEffect(() => {
    if (mode !== 'measure-line' && mode !== 'measure-rect') {
      setMeasureStart(null);
      setMeasureEnd(null);
    }
    if (mode !== 'multi-select') {
      setSelectionStart(null);
      setSelectionEnd(null);
      setSelectedObjectIds([]);
    }
  }, [mode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        
        if (selectedObjectIds.length > 0) {
          handleDeleteSelected();
        } else if (selectedObjectId) {
          handleDeleteObject(selectedObjectId);
          setSelectedObjectId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObjectIds, selectedObjectId, activeRoomId, rooms]);

  const handleCreateRoom = () => {
    const newRoom: Room = {
      id: Math.random().toString(36).substr(2, 9),
      name: `New Room ${rooms.length + 1}`,
      points: [],
      objects: [],
      tempWalls: []
    };
    setRooms([...rooms, newRoom]);
    setActiveRoomId(newRoom.id);
    setMode('draw-room');
    setDrawingPoints([]);
  };

  const handleDuplicateRoom = (room: Room) => {
    const duplicated: Room = {
      ...room,
      id: Math.random().toString(36).substr(2, 9),
      name: `${room.name} (Copy)`
    };
    setRooms([...rooms, duplicated]);
    setActiveRoomId(duplicated.id);
  };

  const handleDeleteRoom = (id: string) => {
    const newRooms = rooms.filter(r => r.id !== id);
    setRooms(newRooms);
    if (activeRoomId === id) {
      setActiveRoomId(newRooms.length > 0 ? newRooms[0].id : null);
    }
  };

  const handleRenameRoom = (id: string, name: string) => {
    setRooms(rooms.map(r => r.id === id ? { ...r, name } : r));
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        console.log("CSV Parse Results:", results);
        const newObjects: ObjectDefinition[] = results.data
          .map((row: any) => {
            if (!row || typeof row !== 'object') return null;
            
            // Flexible key finding
            const findValue = (keywords: string[]) => {
              const key = Object.keys(row).find(k => 
                keywords.some(kw => k.toLowerCase().trim().includes(kw.toLowerCase()))
              );
              return key ? row[key] : null;
            };

            const name = findValue(['name', 'object', 'item']);
            const lengthStr = findValue(['length', 'len', 'l']);
            const widthStr = findValue(['width', 'wid', 'w']);
            
            if (!name || !lengthStr || !widthStr) return null;
            
            const length = parseFeetInches(String(lengthStr));
            const width = parseFeetInches(String(widthStr));
            
            if (length === null || width === null) return null;
            
            return {
              id: Math.random().toString(36).substr(2, 9),
              name: String(name),
              length,
              width
            };
          })
          .filter(Boolean) as ObjectDefinition[];
        
        if (newObjects.length > 0) {
          setObjectLibrary(prev => [...prev, ...newObjects]);
        } else {
          alert("Could not find valid object data in CSV. Ensure columns for Name, Length, and Width exist.");
        }
      }
    });
    // Reset input
    e.target.value = '';
  };

  const handleExportJSON = () => {
    if (!activeRoom) return;
    const exportData = {
      room: activeRoom,
      library: objectLibrary
    };
    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeRoom.name}.json`;
    a.click();
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        let roomToImport;

        if (importedData.room && importedData.library) {
          roomToImport = importedData.room;
          // Merge libraries
          setObjectLibrary(prev => {
            const newLibrary = [...prev];
            importedData.library.forEach((newDef: ObjectDefinition) => {
              if (!newLibrary.some(d => d.id === newDef.id)) {
                newLibrary.push(newDef);
              }
            });
            return newLibrary;
          });
        } else {
          roomToImport = importedData;
        }

        // Ensure ID is unique
        roomToImport.id = Math.random().toString(36).substr(2, 9);
        setRooms([...rooms, roomToImport]);
        setActiveRoomId(roomToImport.id);
      } catch (e) {
        console.error("Import error", e);
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  const snapToGrid = (val: number) => Math.round(val / GRID_SIZE) * GRID_SIZE;

  const findSnapTarget = (x: number, y: number, objId?: string) => {
    if (!activeRoom) return { x: snapToGrid(x), y: snapToGrid(y) };

    const threshold = 0.5; // 6 inches
    let snappedX = snapToGrid(x);
    let snappedY = snapToGrid(y);

    // Snap to walls
    activeRoom.points.forEach((p, i) => {
      const p1 = p;
      const p2 = activeRoom.points[(i + 1) % activeRoom.points.length];
      
      // Vertical wall
      if (Math.abs(p1.x - p2.x) < 0.01) {
        if (Math.abs(x - p1.x) < threshold) snappedX = p1.x;
      }
      // Horizontal wall
      if (Math.abs(p1.y - p2.y) < 0.01) {
        if (Math.abs(y - p1.y) < threshold) snappedY = p1.y;
      }
    });

    // Snap to other objects
    activeRoom.objects.forEach(other => {
      if (other.id === objId) return;
      const otherDef = objectLibrary.find(d => d.id === other.definitionId);
      if (!otherDef) return;
      const rect = getObjectRect(other, otherDef);
      
      const edgesX = [rect.x, rect.x + rect.width];
      const edgesY = [rect.y, rect.y + rect.height];

      edgesX.forEach(ex => {
        if (Math.abs(x - ex) < threshold) snappedX = ex;
      });
      edgesY.forEach(ey => {
        if (Math.abs(y - ey) < threshold) snappedY = ey;
      });
    });

    return { x: snappedX, y: snappedY };
  };

  const handleCanvasClick = (e: any) => {
    const stage = e.target.getStage();
    const pointer = stage.getRelativePointerPosition();
    let { x: gridX, y: gridY } = findSnapTarget(pointer.x / PIXELS_PER_FOOT, pointer.y / PIXELS_PER_FOOT);

    // Handle measurement tools first so they work even when clicking on objects/walls
    if (mode === 'measure-line' || mode === 'measure-rect') {
      if (!measureStart || (measureStart && measureEnd)) {
        setMeasureStart({ x: gridX, y: gridY });
        setMeasureEnd(null);
      } else {
        setMeasureEnd({ x: gridX, y: gridY });
      }
      return; // Exit early for measurement modes
    }

    // If clicking on an object/wall, don't clear selection
    if (e.target !== e.target.getStage()) {
      return;
    }
    
    setSelectedObjectId(null);
    setSelectedWallId(null);
    setSelectedLabelId(null);

    if (mode === 'draw-room') {
      // Enforce horizontal/vertical alignment
      if (drawingPoints.length > 0) {
        const last = drawingPoints[drawingPoints.length - 1];
        const dx = Math.abs(gridX - last.x);
        const dy = Math.abs(gridY - last.y);
        if (dx > dy) {
          gridY = last.y;
        } else {
          gridX = last.x;
        }
      }

      const newPoint = { x: gridX, y: gridY };
      // If clicking near first point, close the polygon
      if (drawingPoints.length > 2) {
        const first = drawingPoints[0];
        if (Math.abs(first.x - gridX) < 0.5 && Math.abs(first.y - gridY) < 0.5) {
          if (activeRoomId) {
            // Ensure the last segment is also axis-aligned to the first point
            const last = drawingPoints[drawingPoints.length - 1];
            if (last.x !== first.x && last.y !== first.y) {
              // Add an intermediate point to close the loop with H/V segments
              setRooms(rooms.map(r => r.id === activeRoomId ? { ...r, points: [...drawingPoints, { x: last.x, y: first.y }] } : r));
            } else {
              setRooms(rooms.map(r => r.id === activeRoomId ? { ...r, points: drawingPoints } : r));
            }
            setMode('select');
            setDrawingPoints([]);
          }
          return;
        }
      }
      setDrawingPoints([...drawingPoints, newPoint]);
    } else if (mode === 'draw-wall') {
      if (!tempWallStart) {
        setTempWallStart({ x: gridX, y: gridY });
      } else {
        // Enforce horizontal/vertical alignment
        const dx = Math.abs(gridX - tempWallStart.x);
        const dy = Math.abs(gridY - tempWallStart.y);
        if (dx > dy) {
          gridY = tempWallStart.y;
        } else {
          gridX = tempWallStart.x;
        }

        const newWall: TempWall = {
          id: Math.random().toString(36).substr(2, 9),
          start: tempWallStart,
          end: { x: gridX, y: gridY },
          color: wallColor,
          isDashed: wallStyle === 'dotted'
        };
        if (activeRoomId) {
          setRooms(rooms.map(r => r.id === activeRoomId ? { ...r, tempWalls: [...r.tempWalls, newWall] } : r));
        }
        setTempWallStart(null);
      }
    } else if (mode === 'add-text') {
      setPendingTextPos({ x: gridX, y: gridY });
      setShowTextInput(true);
    }
  };

  const handleAddText = () => {
    if (!activeRoom || !pendingTextPos || !newText.trim()) return;
    
    const label = {
      id: Math.random().toString(36).substr(2, 9),
      text: newText,
      x: pendingTextPos.x,
      y: pendingTextPos.y,
      fontSize: 1 // 1 foot base size
    };

    setRooms(rooms.map(r => r.id === activeRoomId ? { 
      ...r, 
      labels: [...(r.labels || []), label] 
    } : r));
    
    setNewText("");
    setShowTextInput(false);
    setPendingTextPos(null);
    setMode('select');
  };

  const handleManualAddItem = () => {
    if (!newItemName.trim()) return;
    const length = (parseFloat(newItemLFeet) || 0) + (parseFloat(newItemLInches) || 0) / 12;
    const width = (parseFloat(newItemWFeet) || 0) + (parseFloat(newItemWInches) || 0) / 12;
    
    if (length <= 0 || width <= 0) return;

    const newDef: ObjectDefinition = {
      id: Math.random().toString(36).substr(2, 9),
      name: newItemName,
      length,
      width,
      type: 'standard'
    };

    setObjectLibrary([...objectLibrary, newDef]);
    setNewItemName("");
  };

  const handleMouseMove = (e: any) => {
    const stage = e.target.getStage();
    const pointer = stage.getRelativePointerPosition();
    const currentPos = { 
      x: pointer.x / PIXELS_PER_FOOT, 
      y: pointer.y / PIXELS_PER_FOOT 
    };
    setMousePos(currentPos);
    
    if (mode === 'multi-select' && selectionStart) {
      setSelectionEnd(currentPos);
    }
  };

  const handleMouseDown = (e: any) => {
    if (mode === 'multi-select' && e.target === e.currentTarget) {
      const stage = e.target.getStage();
      const pointer = stage.getRelativePointerPosition();
      setSelectionStart({ x: pointer.x / PIXELS_PER_FOOT, y: pointer.y / PIXELS_PER_FOOT });
      setSelectionEnd(null);
      setSelectedObjectIds([]);
    }
  };

  const handleMouseUp = (e: any) => {
    if (mode === 'multi-select' && selectionStart && selectionEnd) {
      if (!activeRoom) return;
      
      const x1 = Math.min(selectionStart.x, selectionEnd.x);
      const y1 = Math.min(selectionStart.y, selectionEnd.y);
      const x2 = Math.max(selectionStart.x, selectionEnd.x);
      const y2 = Math.max(selectionStart.y, selectionEnd.y);
      
      const selected = activeRoom.objects.filter(obj => {
        const def = objectLibrary.find(d => d.id === obj.definitionId);
        if (!def) return false;
        
        const isRotated = obj.rotation === 90 || obj.rotation === 270;
        const w = isRotated ? def.length : def.width;
        const h = isRotated ? def.width : def.length;
        
        const objX1 = obj.x - w/2;
        const objY1 = obj.y - h/2;
        const objX2 = obj.x + w/2;
        const objY2 = obj.y + h/2;
        
        return objX1 >= x1 && objX2 <= x2 && objY1 >= y1 && objY2 <= y2;
      }).map(o => o.id);
      
      setSelectedObjectIds(selected);
      setSelectionStart(null);
      setSelectionEnd(null);
    }
  };

  const handleObjectDrop = (def: ObjectDefinition, x: number, y: number) => {
    if (!activeRoom) return;
    
    const newObj: PlacedObject = {
      id: Math.random().toString(36).substr(2, 9),
      definitionId: def.id,
      x: x,
      y: y,
      rotation: 0
    };

    // Allow placement outside room
    setRooms(rooms.map(r => r.id === activeRoomId ? { ...r, objects: [...r.objects, newObj] } : r));
  };

  const isValidPlacement = (obj: PlacedObject, room: Room, excludeId?: string) => {
    const def = objectLibrary.find(d => d.id === obj.definitionId);
    if (!def) return false;

    const rect = getObjectRect(obj, def);

    // 1. Object Overlap Check
    for (const other of room.objects) {
      if (other.id === excludeId || other.id === obj.id) continue;
      const otherDef = objectLibrary.find(d => d.id === other.definitionId);
      if (!otherDef) continue;
      const otherRect = getObjectRect(other, otherDef);
      if (checkRectOverlap(rect, otherRect)) return false;
    }

    // 2. Temp Wall Overlap Check
    for (const wall of room.tempWalls) {
      if (lineIntersectRect(wall.start, wall.end, rect)) return false;
    }

    return true;
  };

  const handleObjectDragMove = (id: string, e: any) => {
    if (!activeRoom || !selectedObjectIds.includes(id)) return;
    
    const obj = activeRoom.objects.find(o => o.id === id);
    if (!obj) return;

    const newX = e.target.x() / PIXELS_PER_FOOT;
    const newY = e.target.y() / PIXELS_PER_FOOT;
    
    const dx = newX - obj.x;
    const dy = newY - obj.y;

    setRooms(rooms.map(r => r.id === activeRoomId ? {
      ...r,
      objects: r.objects.map(o => {
        if (selectedObjectIds.includes(o.id) && o.id !== id) {
          return { ...o, x: o.x + dx, y: o.y + dy };
        }
        if (o.id === id) {
          return { ...o, x: newX, y: newY };
        }
        return o;
      })
    } : r));
  };

  const handleObjectDragEnd = (id: string, e: any) => {
    if (!activeRoom) return;
    
    const newX = e.target.x() / PIXELS_PER_FOOT;
    const newY = e.target.y() / PIXELS_PER_FOOT;

    const obj = activeRoom.objects.find(o => o.id === id);
    if (!obj) return;

    if (selectedObjectIds.includes(id)) {
      const dx = newX - obj.x;
      const dy = newY - obj.y;
      
      setRooms(rooms.map(r => r.id === activeRoomId ? { 
        ...r, 
        objects: r.objects.map(o => {
          if (selectedObjectIds.includes(o.id) && o.id !== id) {
            return { ...o, x: o.x + dx, y: o.y + dy };
          }
          if (o.id === id) {
            return { ...o, x: newX, y: newY };
          }
          return o;
        }) 
      } : r));
    } else {
      setRooms(rooms.map(r => r.id === activeRoomId ? { 
        ...r, 
        objects: r.objects.map(o => o.id === id ? { ...o, x: newX, y: newY } : o) 
      } : r));
    }
  };

  const handleWallDragEnd = (id: string, e: any) => {
    if (!activeRoom) return;
    
    const wall = activeRoom.tempWalls.find(w => w.id === id);
    if (!wall) return;

    const newStartX = snapToGrid(e.target.x() / PIXELS_PER_FOOT);
    const newStartY = snapToGrid(e.target.y() / PIXELS_PER_FOOT);
    
    const dx = newStartX - wall.start.x;
    const dy = newStartY - wall.start.y;

    const updatedWall = {
      ...wall,
      start: { x: newStartX, y: newStartY },
      end: { x: wall.end.x + dx, y: wall.end.y + dy }
    };

    setRooms(rooms.map(r => r.id === activeRoomId ? { 
      ...r, 
      tempWalls: r.tempWalls.map(w => w.id === id ? updatedWall : w) 
    } : r));
  };

  const handleRotate = (id: string) => {
    if (!activeRoom) return;
    const obj = activeRoom.objects.find(o => o.id === id);
    if (!obj) return;

    const nextRotation = (obj.rotation + 90) % 360;
    const updatedObj = { ...obj, rotation: nextRotation };

    if (isValidPlacement(updatedObj, activeRoom, id)) {
      setRooms(rooms.map(r => r.id === activeRoomId ? { 
        ...r, 
        objects: r.objects.map(o => o.id === id ? updatedObj : o) 
      } : r));
    }
  };

  const handleDeleteObject = (id: string) => {
    if (!activeRoom) return;
    setRooms(rooms.map(r => r.id === activeRoomId ? { 
      ...r, 
      objects: r.objects.filter(o => o.id !== id) 
    } : r));
  };

  const handleDeleteWall = (id: string) => {
    if (!activeRoom) return;
    setRooms(rooms.map(r => r.id === activeRoomId ? { 
      ...r, 
      tempWalls: r.tempWalls.filter(w => w.id !== id) 
    } : r));
  };

  const handleAddWallManual = () => {
    if (!activeRoom) return;
    const feet = parseFloat(wallFeet) || 0;
    const inches = parseFloat(wallInches) || 0;
    const length = feet + inches / 12;
    if (length <= 0) return;

    // Place at center of view or near mouse
    const start = { x: snapToGrid(mousePos.x), y: snapToGrid(mousePos.y) };
    const end = wallOrientation === 'h' 
      ? { x: start.x + length, y: start.y }
      : { x: start.x, y: start.y + length };

    const newWall: TempWall = {
      id: Math.random().toString(36).substr(2, 9),
      start,
      end,
      color: wallColor,
      isDashed: wallStyle === 'dotted'
    };

    setRooms(rooms.map(r => r.id === activeRoomId ? { ...r, tempWalls: [...r.tempWalls, newWall] } : r));
  };

  const handleBulkWallInput = () => {
    const lines = bulkInputText.trim().split('\n');
    const segments: { length: number, orientation: 'H' | 'V' }[] = [];
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const feet = parseInt(parts[0], 10);
        const inches = parseInt(parts[1], 10);
        const orientation = parts[2].toUpperCase() as 'H' | 'V';
        if (!isNaN(feet) && !isNaN(inches) && (orientation === 'H' || orientation === 'V')) {
          segments.push({ length: feet + inches / 12, orientation });
        }
      }
    }

    if (segments.length === 0) return;

    // Try to find a closing path for a room
    // For simplicity, we'll try a greedy approach or just create a sequence of temp walls
    // If it looks like a room (many segments), we'll try to make it a room polygon.
    
    let current = { x: snapToGrid(mousePos.x), y: snapToGrid(mousePos.y) };
    const points: Point[] = [current];
    const tempWalls: TempWall[] = [];

    // Heuristic for directions to close the loop
    // We'll use the user's data as a sequence. 
    // For the first half of segments, we go positive. For the second half, we go negative.
    // This is a very rough heuristic but works for simple rectangular/L-shaped rooms.
    // A better way is to solve the subset sum problem for H and V components to reach 0.
    
    const hSegments = segments.filter(s => s.orientation === 'H');
    const vSegments = segments.filter(s => s.orientation === 'V');
    
    const solveDirections = (segs: typeof segments) => {
      const n = segs.length;
      const total = segs.reduce((sum, s) => sum + s.length, 0);
      // Try all combinations (up to 2^10 is fine)
      if (n > 12) return segs.map(s => s.length); // Fallback
      
      for (let i = 0; i < (1 << n); i++) {
        let sum = 0;
        const dirs = [];
        for (let j = 0; j < n; j++) {
          const dir = (i & (1 << j)) ? 1 : -1;
          sum += segs[j].length * dir;
          dirs.push(dir);
        }
        if (Math.abs(sum) < 0.01) return segs.map((s, idx) => s.length * dirs[idx]);
      }
      return segs.map(s => s.length); // Fallback
    };

    const hLengths = solveDirections(hSegments);
    const vLengths = solveDirections(vSegments);
    
    let hIdx = 0;
    let vIdx = 0;
    
    for (const seg of segments) {
      const length = seg.orientation === 'H' ? hLengths[hIdx++] : vLengths[vIdx++];
      const next = seg.orientation === 'H' 
        ? { x: current.x + length, y: current.y }
        : { x: current.x, y: current.y + length };
      
      points.push(next);
      current = next;
    }

    // Normalization: Ensure all points are within a reasonable positive grid area
    const minX = Math.min(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    
    // Shift points so the bounding box starts at (10, 10) for visibility
    const offsetX = 10 - minX;
    const offsetY = 10 - minY;
    
    const normalizedPoints = points.map(p => ({
      x: snapToGrid(p.x + offsetX),
      y: snapToGrid(p.y + offsetY)
    }));

    // If it closes (last point near first), make it a room
    const distToStart = Math.sqrt(Math.pow(normalizedPoints[normalizedPoints.length-1].x - normalizedPoints[0].x, 2) + Math.pow(normalizedPoints[normalizedPoints.length-1].y - normalizedPoints[0].y, 2));
    
    if (distToStart < 1) {
      const newRoom: Room = {
        id: Math.random().toString(36).substr(2, 9),
        name: `Bulk Room ${rooms.length + 1}`,
        points: normalizedPoints.slice(0, -1), // Remove the closing point as Konva 'closed' handles it
        objects: [],
        tempWalls: []
      };
      setRooms([...rooms, newRoom]);
      setActiveRoomId(newRoom.id);
    } else {
      // Just add as temp walls
      const newWalls: TempWall[] = [];
      for (let i = 1; i < normalizedPoints.length; i++) {
        newWalls.push({
          id: Math.random().toString(36).substr(2, 9),
          start: normalizedPoints[i-1],
          end: normalizedPoints[i]
        });
      }
      if (activeRoomId) {
        setRooms(rooms.map(r => r.id === activeRoomId ? { ...r, tempWalls: [...r.tempWalls, ...newWalls] } : r));
      } else {
        // Create a room to hold them
        const newRoom: Room = {
          id: Math.random().toString(36).substr(2, 9),
          name: `Imported Walls`,
          points: [],
          objects: [],
          tempWalls: newWalls
        };
        setRooms([...rooms, newRoom]);
        setActiveRoomId(newRoom.id);
      }
    }

    setShowBulkInput(false);
    setBulkInputText("");
  };

  const handleDeleteSelected = () => {
    if (!activeRoom) return;
    
    if (selectedObjectIds.length > 0) {
      setRooms(rooms.map(r => r.id === activeRoomId ? { 
        ...r, 
        objects: r.objects.filter(o => !selectedObjectIds.includes(o.id)) 
      } : r));
      setSelectedObjectIds([]);
    } else if (selectedObjectId) {
      handleDeleteObject(selectedObjectId);
      setSelectedObjectId(null);
    } else if (selectedWallId) {
      handleDeleteWall(selectedWallId);
      setSelectedWallId(null);
    } else if (selectedLabelId) {
      setRooms(rooms.map(r => r.id === activeRoomId ? {
        ...r,
        labels: r.labels?.filter(l => l.id !== selectedLabelId)
      } : r));
      setSelectedLabelId(null);
    }
  };

  const area = activeRoom ? calculatePolygonArea(activeRoom.points) : 0;

  return (
    <div className="flex h-screen w-screen bg-zinc-50 font-sans text-zinc-900 overflow-hidden">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 320 : 0 }}
        className="bg-white border-r border-zinc-200 flex flex-col overflow-hidden relative z-20"
      >
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between min-w-[320px]">
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Layout className="w-6 h-6 text-indigo-600" />
            8th Floor
          </h1>
          <button onClick={() => setSidebarOpen(false)} className="p-1 hover:bg-zinc-100 rounded">
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-w-[320px] p-4 space-y-6">
          {/* Rooms Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Rooms</h2>
              <div className="flex items-center gap-1">
                <label className="p-1 text-zinc-500 hover:bg-zinc-100 rounded-full cursor-pointer transition-colors" title="Import Room">
                  <Upload className="w-4 h-4" />
                  <input type="file" accept=".json" className="hidden" onChange={handleImportJSON} />
                </label>
                {activeRoom && (
                  <button 
                    onClick={handleExportJSON}
                    className="p-1 text-zinc-500 hover:bg-zinc-100 rounded-full transition-colors"
                    title="Export Active Room"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                <button 
                  onClick={handleCreateRoom}
                  className="p-1 text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                  title="New Room"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {rooms.map(room => (
                <div 
                  key={room.id}
                  onClick={() => setActiveRoomId(room.id)}
                  className={cn(
                    "group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all",
                    activeRoomId === room.id ? "bg-indigo-50 text-indigo-700" : "hover:bg-zinc-50"
                  )}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Square className="w-4 h-4 flex-shrink-0" />
                    <input 
                      className="bg-transparent border-none focus:ring-0 p-0 text-sm font-medium truncate w-full"
                      value={room.name}
                      onChange={(e) => handleRenameRoom(room.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); handleDuplicateRoom(room); }} className="p-1 hover:bg-white rounded text-zinc-400 hover:text-indigo-600">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room.id); }} className="p-1 hover:bg-white rounded text-zinc-400 hover:text-red-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Object Library */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Items Library</h2>
              <label className="p-1 text-indigo-600 hover:bg-indigo-50 rounded-full cursor-pointer transition-colors">
                <Upload className="w-4 h-4" />
                <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
              </label>
            </div>

            {/* Manual Add Form */}
            <div className="mb-4 p-3 bg-zinc-50 rounded-xl border border-zinc-200 space-y-2">
              <input 
                className="w-full p-2 bg-white border border-zinc-200 rounded-lg text-[10px] outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Item Name (e.g. Rack A)"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[9px] text-zinc-400 uppercase font-bold">Length</span>
                  <div className="flex gap-1">
                    <input type="number" className="w-full p-1 text-[10px] border border-zinc-200 rounded" placeholder="ft" value={newItemLFeet} onChange={(e) => setNewItemLFeet(e.target.value)} />
                    <input type="number" className="w-full p-1 text-[10px] border border-zinc-200 rounded" placeholder="in" value={newItemLInches} onChange={(e) => setNewItemLInches(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] text-zinc-400 uppercase font-bold">Width</span>
                  <div className="flex gap-1">
                    <input type="number" className="w-full p-1 text-[10px] border border-zinc-200 rounded" placeholder="ft" value={newItemWFeet} onChange={(e) => setNewItemWFeet(e.target.value)} />
                    <input type="number" className="w-full p-1 text-[10px] border border-zinc-200 rounded" placeholder="in" value={newItemWInches} onChange={(e) => setNewItemWInches(e.target.value)} />
                  </div>
                </div>
              </div>
              <button 
                onClick={handleManualAddItem}
                className="w-full py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Add to Library
              </button>
            </div>
            
            {objectLibrary.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-zinc-100 rounded-xl">
                <FileText className="w-8 h-8 text-zinc-200 mx-auto mb-2" />
                <p className="text-xs text-zinc-400">Import CSV to add objects</p>
                <p className="text-[10px] text-zinc-300 mt-1">Name, Length, Width</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {objectLibrary.map(obj => {
                  const count = activeRoom?.objects.filter(o => o.definitionId === obj.id).length || 0;
                  return (
                    <div 
                      key={obj.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggedObject(obj);
                      }}
                      className="p-3 bg-white border border-zinc-200 rounded-xl hover:border-indigo-300 cursor-grab active:cursor-grabbing transition-all group"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2">
                          {obj.type === 'door' && <DoorOpen className="w-4 h-4 text-indigo-500" />}
                          <span className="text-sm font-semibold text-zinc-800">{obj.name}</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded-full font-mono">
                          {count}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 font-mono">
                        {formatFeetInches(obj.length)} × {formatFeetInches(obj.width)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Stats */}
          {activeRoom && (
            <section className="pt-4 border-t border-zinc-100">
              <div className="bg-zinc-900 text-white p-4 rounded-2xl shadow-lg">
                <div className="flex items-center gap-2 text-zinc-400 mb-1">
                  <Info className="w-4 h-4" />
                  <span className="text-[10px] uppercase font-bold tracking-widest">Room Stats</span>
                </div>
                <div className="text-2xl font-light">
                  {Math.round(area).toLocaleString()} <span className="text-sm text-zinc-500">sq ft</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button 
                    onClick={() => {
                      if (confirm("Clear all objects and walls in this room?")) {
                        setRooms(rooms.map(r => r.id === activeRoomId ? { ...r, objects: [], tempWalls: [] } : r));
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-red-900/50 hover:bg-red-800 rounded-lg text-xs font-medium text-red-200 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" /> Clear Room
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </motion.aside>

      {!sidebarOpen && (
        <button 
          onClick={() => setSidebarOpen(true)}
          className="absolute top-4 left-4 z-30 p-2 bg-white shadow-md rounded-full hover:bg-zinc-50 border border-zinc-200"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-white/80 backdrop-blur-md border border-zinc-200 shadow-xl rounded-2xl">
            <ToolButton 
              active={mode === 'select'} 
              onClick={() => setMode('select')} 
              icon={<MousePointer2 className="w-4 h-4" />} 
              label="Move View" 
            />
            <ToolButton 
              active={mode === 'move'} 
              onClick={() => setMode('move')} 
              icon={<Move className="w-4 h-4" />} 
              label="Move Object" 
            />
            <ToolButton 
              active={mode === 'multi-select'} 
              onClick={() => setMode('multi-select')} 
              icon={<MousePointerSquareDashed className="w-4 h-4" />} 
              label="Multi-Select" 
            />
            <ToolButton 
              active={mode === 'draw-room'} 
              onClick={() => { setMode('draw-room'); setDrawingPoints([]); }} 
              icon={<Square className="w-4 h-4" />} 
              label="Draw Room" 
            />
            <ToolButton 
              active={mode === 'draw-wall'} 
              onClick={() => { setMode('draw-wall'); setTempWallStart(null); }} 
              icon={<PenTool className="w-4 h-4" />} 
              label="Temp Wall" 
            />
            <div className="w-px h-6 bg-zinc-200 mx-1" />
            <ToolButton 
              active={mode === 'measure-line'} 
              onClick={() => { setMode('measure-line'); setMeasureStart(null); }} 
              icon={<Ruler className="w-4 h-4" />} 
              label="Measure Line" 
            />
            <ToolButton 
              active={mode === 'measure-rect'} 
              onClick={() => { setMode('measure-rect'); setMeasureStart(null); }} 
              icon={<BoxSelect className="w-4 h-4" />} 
              label="Measure Rectangle" 
            />
            <ToolButton 
              active={mode === 'add-text'} 
              onClick={() => { setMode('add-text'); setPendingTextPos(null); }} 
              icon={<Type className="w-4 h-4" />} 
              label="Add Text" 
            />
            <div className="w-px h-6 bg-zinc-200 mx-1" />
            
            <button 
              onClick={() => setViewLocked(!viewLocked)}
              className={cn(
                "p-2 rounded-xl transition-all",
                viewLocked ? "bg-amber-100 text-amber-700" : "hover:bg-zinc-100 text-zinc-500"
              )}
              title={viewLocked ? "Unlock View" : "Lock View"}
            >
              {viewLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>

            <div className="w-px h-6 bg-zinc-200 mx-1" />
            
            <button 
              onClick={undo} 
              disabled={historyIndex <= 0}
              className="p-2 hover:bg-zinc-100 rounded-xl text-zinc-500 disabled:opacity-30"
              title="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={redo} 
              disabled={historyIndex >= history.length - 1}
              className="p-2 hover:bg-zinc-100 rounded-xl text-zinc-500 disabled:opacity-30"
              title="Redo"
            >
              <Redo2 className="w-4 h-4" />
            </button>
            <button 
              onClick={handleDeleteSelected} 
              disabled={!selectedObjectId && !selectedWallId && !selectedLabelId && selectedObjectIds.length === 0}
              className="p-2 hover:bg-red-50 rounded-xl text-zinc-500 hover:text-red-600 disabled:opacity-30"
              title="Delete Selected"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <div className="w-px h-6 bg-zinc-200 mx-1" />
            <div className="flex items-center gap-2 px-3">
              <button onClick={() => setZoom(z => Math.max(0.05, z - 0.1))} className="p-1 hover:bg-zinc-100 rounded">-</button>
              <span className="text-[10px] font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(5, z + 0.1))} className="p-1 hover:bg-zinc-100 rounded">+</button>
            </div>
          </div>

          {/* Wall Builder Panel */}
          <div className="flex items-center gap-3 p-2 bg-white/80 backdrop-blur-md border border-zinc-200 shadow-lg rounded-xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2">Wall Builder</span>
            
            <div className="flex items-center gap-1">
              <div className="flex items-center bg-zinc-100 rounded-lg p-1">
                <input 
                  type="number" 
                  value={wallFeet}
                  onChange={(e) => setWallFeet(e.target.value)}
                  className="w-10 bg-transparent border-none focus:ring-0 text-xs font-mono text-center"
                  placeholder="ft"
                />
                <span className="text-[10px] text-zinc-400 pr-1">ft</span>
              </div>
              <div className="flex items-center bg-zinc-100 rounded-lg p-1">
                <input 
                  type="number" 
                  value={wallInches}
                  onChange={(e) => setWallInches(e.target.value)}
                  className="w-10 bg-transparent border-none focus:ring-0 text-xs font-mono text-center"
                  placeholder="in"
                />
                <span className="text-[10px] text-zinc-400 pr-1">in</span>
              </div>
            </div>

            <div className="flex bg-zinc-100 rounded-lg p-1">
              <button 
                onClick={() => setWallOrientation('h')}
                className={cn("p-1 rounded-md transition-all", wallOrientation === 'h' ? "bg-white shadow-sm text-indigo-600" : "text-zinc-400")}
                title="Horizontal"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => setWallOrientation('v')}
                className={cn("p-1 rounded-md transition-all", wallOrientation === 'v' ? "bg-white shadow-sm text-indigo-600" : "text-zinc-400")}
                title="Vertical"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="w-px h-6 bg-zinc-200 mx-1" />

            {/* Color Picker */}
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className={cn(
                  "w-6 h-6 rounded-full border border-black/10 transition-all shadow-sm flex items-center justify-center",
                  showColorPicker ? "ring-2 ring-indigo-500 ring-offset-1" : "hover:scale-110"
                )}
                style={{ backgroundColor: wallColor }}
              >
                <div className="w-1 h-1 rounded-full bg-white/50" />
              </button>

              {showColorPicker && (
                <>
                  <div 
                    className="fixed inset-0 z-20" 
                    onClick={() => setShowColorPicker(false)} 
                  />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 bg-white border border-zinc-200 shadow-xl rounded-xl z-30 flex gap-1 animate-in fade-in slide-in-from-bottom-2">
                    {WALL_COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => {
                          setWallColor(color);
                          setShowColorPicker(false);
                        }}
                        className={cn(
                          "w-5 h-5 rounded-full border border-black/5 transition-all",
                          wallColor === color ? "scale-125 ring-2 ring-indigo-500 ring-offset-1" : "hover:scale-110"
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="w-px h-6 bg-zinc-200 mx-1" />

            {/* Style Picker */}
            <div className="flex bg-zinc-100 rounded-lg p-1">
              <button 
                onClick={() => setWallStyle('solid')}
                className={cn("px-2 py-1 text-[10px] font-bold rounded-md transition-all", wallStyle === 'solid' ? "bg-white shadow-sm text-indigo-600" : "text-zinc-400")}
              >
                Solid
              </button>
              <button 
                onClick={() => setWallStyle('dotted')}
                className={cn("px-2 py-1 text-[10px] font-bold rounded-md transition-all", wallStyle === 'dotted' ? "bg-white shadow-sm text-indigo-600" : "text-zinc-400")}
              >
                Dotted
              </button>
            </div>

            <div className="w-px h-6 bg-zinc-200 mx-1" />

            <button 
              onClick={handleAddWallManual}
              className="px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100"
            >
              Add Wall
            </button>
            <button 
              onClick={() => setShowBulkInput(true)}
              className="px-3 py-1.5 bg-zinc-800 text-white text-[10px] font-bold rounded-lg hover:bg-zinc-700 transition-all shadow-md"
            >
              Bulk Input
            </button>
          </div>
        </div>

        {/* Text Input Modal */}
        <AnimatePresence>
          {showTextInput && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm p-4"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col"
              >
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                  <h3 className="text-lg font-bold">Add Label</h3>
                  <button onClick={() => setShowTextInput(false)} className="p-2 hover:bg-zinc-100 rounded-full">
                    <ChevronLeft className="w-5 h-5 rotate-90" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <input 
                    autoFocus
                    className="w-full p-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    placeholder="Enter text..."
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddText()}
                  />
                  <button 
                    onClick={handleAddText}
                    className="w-full py-3 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                  >
                    Add Text
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showBulkInput && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm p-4"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
              >
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold">Bulk Wall Input</h3>
                    <p className="text-xs text-zinc-400">Paste a list of wall segments (Feet, Inches, Orientation)</p>
                  </div>
                  <button onClick={() => setShowBulkInput(false)} className="p-2 hover:bg-zinc-100 rounded-full">
                    <ChevronLeft className="w-5 h-5 rotate-90" />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <textarea 
                    className="w-full h-64 p-4 bg-zinc-50 border border-zinc-200 rounded-2xl font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none"
                    placeholder="51 3 V&#10;9 3 H&#10;41 9 V..."
                    value={bulkInputText}
                    onChange={(e) => setBulkInputText(e.target.value)}
                  />
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setBulkInputText("51 3 V\n9 3 H\n41 9 V\n9 10 H\n29 9 V\n84 0 H\n98 11 V\n22 0 H\n23 10 V\n81 1 H")}
                      className="flex-1 py-3 bg-zinc-100 text-zinc-600 text-xs font-bold rounded-xl hover:bg-zinc-200 transition-all"
                    >
                      Load Example
                    </button>
                    <button 
                      onClick={handleBulkWallInput}
                      className="flex-[2] py-3 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
                    >
                      Process Segments
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selection Actions */}
        <AnimatePresence>
          {selectedObjectIds.length > 0 && (
            <motion.div 
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="absolute top-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 p-2 bg-white/90 backdrop-blur-md border border-zinc-200 shadow-xl rounded-2xl"
            >
              <span className="text-xs font-bold px-2 text-zinc-500">{selectedObjectIds.length} selected</span>
              <div className="w-px h-4 bg-zinc-200 mx-1" />
              <button 
                onClick={handleDeleteSelected}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 transition-all"
              >
                <Trash2 className="w-4 h-4" />
                Delete Selected
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Canvas Area */}
        <div 
          className="flex-1 canvas-container cursor-crosshair"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (draggedObject) {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = (e.clientX - rect.left - stagePos.x) / (PIXELS_PER_FOOT * zoom);
              const y = (e.clientY - rect.top - stagePos.y) / (PIXELS_PER_FOOT * zoom);
              handleObjectDrop(draggedObject, x, y);
              setDraggedObject(null);
            }
          }}
        >
          <Stage
            width={window.innerWidth}
            height={window.innerHeight}
            scaleX={zoom}
            scaleY={zoom}
            x={stagePos.x}
            y={stagePos.y}
            draggable={mode === 'select' && !viewLocked}
            onDragEnd={(e) => {
              if (e.target === e.currentTarget) {
                setStagePos({ x: e.target.x(), y: e.target.y() });
              }
            }}
            onWheel={(e) => {
              if (viewLocked) return;
              e.evt.preventDefault();
              const scaleBy = 1.1;
              const stage = e.target.getStage();
              const oldScale = stage.scaleX();
              const pointer = stage.getPointerPosition();

              const mousePointTo = {
                x: (pointer.x - stage.x()) / oldScale,
                y: (pointer.y - stage.y()) / oldScale,
              };

              const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
              const clampedScale = Math.max(0.05, Math.min(5, newScale));
              setZoom(clampedScale);
              setStagePos({
                x: pointer.x - mousePointTo.x * clampedScale,
                y: pointer.y - mousePointTo.y * clampedScale,
              });
            }}
            onClick={handleCanvasClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
          >
            <Layer>
              {/* Grid */}
              <GridLayer zoom={zoom} />

              {/* Room Boundary */}
              {activeRoom && activeRoom.points.length > 0 && (
                <Group>
                  {activeRoom.points.map((p, i) => {
                    const next = activeRoom.points[(i + 1) % activeRoom.points.length];
                    return (
                      <Line
                        key={i}
                        points={[p.x * PIXELS_PER_FOOT, p.y * PIXELS_PER_FOOT, next.x * PIXELS_PER_FOOT, next.y * PIXELS_PER_FOOT]}
                        stroke="#4f46e5"
                        strokeWidth={4 / zoom}
                        hitStrokeWidth={20 / zoom}
                        onMouseEnter={() => setHoveredWall({ start: p, end: next })}
                        onMouseLeave={() => setHoveredWall(null)}
                      />
                    );
                  })}
                  {/* Fill */}
                  <Line
                    points={activeRoom.points.flatMap(p => [p.x * PIXELS_PER_FOOT, p.y * PIXELS_PER_FOOT])}
                    closed
                    fill="#4f46e510"
                    listening={false}
                  />
                </Group>
              )}

              {/* Drawing Room Preview */}
              {mode === 'draw-room' && drawingPoints.length > 0 && (
                <Group>
                  <Line
                    points={[
                      ...drawingPoints.flatMap(p => [p.x * PIXELS_PER_FOOT, p.y * PIXELS_PER_FOOT]),
                      // Enforce H/V preview
                      (drawingPoints.length > 0 && Math.abs(mousePos.x - drawingPoints[drawingPoints.length - 1].x) > Math.abs(mousePos.y - drawingPoints[drawingPoints.length - 1].y)) 
                        ? mousePos.x * PIXELS_PER_FOOT 
                        : drawingPoints[drawingPoints.length - 1].x * PIXELS_PER_FOOT,
                      (drawingPoints.length > 0 && Math.abs(mousePos.x - drawingPoints[drawingPoints.length - 1].x) > Math.abs(mousePos.y - drawingPoints[drawingPoints.length - 1].y))
                        ? drawingPoints[drawingPoints.length - 1].y * PIXELS_PER_FOOT
                        : mousePos.y * PIXELS_PER_FOOT
                    ]}
                    stroke="#4f46e5"
                    strokeWidth={2 / zoom}
                    dash={[5, 5]}
                  />
                  {drawingPoints.map((p, i) => {
                    const next = drawingPoints[i + 1] || mousePos;
                    const dist = Math.sqrt(Math.pow(next.x - p.x, 2) + Math.pow(next.y - p.y, 2));
                    return (
                      <Group key={i}>
                        <Circle 
                          x={p.x * PIXELS_PER_FOOT} 
                          y={p.y * PIXELS_PER_FOOT} 
                          radius={4 / zoom} 
                          fill="#4f46e5" 
                        />
                        <Text 
                          text={formatFeetInches(dist)}
                          x={(p.x + next.x) / 2 * PIXELS_PER_FOOT}
                          y={(p.y + next.y) / 2 * PIXELS_PER_FOOT - 20 / zoom}
                          fontSize={14 / zoom}
                          fill="#4f46e5"
                          fontFamily="JetBrains Mono"
                        />
                      </Group>
                    );
                  })}
                </Group>
              )}

              {/* Temp Walls */}
              {activeRoom?.tempWalls.map(wall => (
                <WallOnCanvas
                  key={wall.id}
                  wall={wall}
                  zoom={zoom}
                  mode={mode}
                  onDragEnd={(e) => handleWallDragEnd(wall.id, e)}
                  onDelete={() => handleDeleteWall(wall.id)}
                  onHover={() => setHoveredWall({ start: wall.start, end: wall.end })}
                  onUnhover={() => setHoveredWall(null)}
                  isSelected={selectedWallId === wall.id}
                  onSelect={() => {
                    setSelectedWallId(wall.id);
                    setSelectedObjectId(null);
                    setSelectedLabelId(null);
                  }}
                />
              ))}


              {/* Drawing Wall Preview */}
              {mode === 'draw-wall' && tempWallStart && (
                <Line
                  points={[
                    tempWallStart.x * PIXELS_PER_FOOT, 
                    tempWallStart.y * PIXELS_PER_FOOT, 
                    // Enforce H/V preview
                    Math.abs(mousePos.x - tempWallStart.x) > Math.abs(mousePos.y - tempWallStart.y) ? mousePos.x * PIXELS_PER_FOOT : tempWallStart.x * PIXELS_PER_FOOT,
                    Math.abs(mousePos.x - tempWallStart.x) > Math.abs(mousePos.y - tempWallStart.y) ? tempWallStart.y * PIXELS_PER_FOOT : mousePos.y * PIXELS_PER_FOOT
                  ]}
                  stroke="#94a3b8"
                  strokeWidth={2 / zoom}
                  dash={[10, 5]}
                />
              )}

              {/* Measurement Line Preview */}
              {mode === 'measure-line' && measureStart && (
                <Group>
                  <Line
                    points={[
                      measureStart.x * PIXELS_PER_FOOT,
                      measureStart.y * PIXELS_PER_FOOT,
                      (measureEnd || mousePos).x * PIXELS_PER_FOOT,
                      (measureEnd || mousePos).y * PIXELS_PER_FOOT
                    ]}
                    stroke="#10b981"
                    strokeWidth={2 / zoom}
                    dash={[5, 5]}
                  />
                  <Text
                    text={formatFeetInches(Math.sqrt(Math.pow((measureEnd || mousePos).x - measureStart.x, 2) + Math.pow((measureEnd || mousePos).y - measureStart.y, 2)))}
                    x={(measureStart.x + (measureEnd || mousePos).x) / 2 * PIXELS_PER_FOOT}
                    y={(measureStart.y + (measureEnd || mousePos).y) / 2 * PIXELS_PER_FOOT - 25 / zoom}
                    fontSize={16 / zoom}
                    fill="#059669"
                    fontFamily="JetBrains Mono"
                    align="center"
                  />
                </Group>
              )}

              {/* Measurement Rect Preview */}
              {mode === 'measure-rect' && measureStart && (
                <Group>
                  <Rect
                    x={Math.min(measureStart.x, (measureEnd || mousePos).x) * PIXELS_PER_FOOT}
                    y={Math.min(measureStart.y, (measureEnd || mousePos).y) * PIXELS_PER_FOOT}
                    width={Math.abs((measureEnd || mousePos).x - measureStart.x) * PIXELS_PER_FOOT}
                    height={Math.abs((measureEnd || mousePos).y - measureStart.y) * PIXELS_PER_FOOT}
                    stroke="#10b981"
                    strokeWidth={2 / zoom}
                    fill="#10b98110"
                    dash={[5, 5]}
                  />
                  {(() => {
                    const currentEnd = measureEnd || mousePos;
                    const w = Math.abs(currentEnd.x - measureStart.x);
                    const h = Math.abs(currentEnd.y - measureStart.y);
                    const area = w * h;
                    
                    // Pallet calculation: 48"x40" (4' x 3.333')
                    const palletW = 4;
                    const palletH = 40 / 12;
                    
                    const fit1 = Math.floor(w / palletW) * Math.floor(h / palletH);
                    const fit2 = Math.floor(w / palletH) * Math.floor(h / palletW);
                    const maxPallets = Math.max(fit1, fit2);
                    
                    // Maneuverable estimate: approx 65% utilization for aisles/walking
                    const estPallets = Math.floor(maxPallets * 0.65);

                    const rectX = Math.min(measureStart.x, currentEnd.x) * PIXELS_PER_FOOT;
                    const rectY = Math.min(measureStart.y, currentEnd.y) * PIXELS_PER_FOOT;
                    const rectW = w * PIXELS_PER_FOOT;
                    const rectH = h * PIXELS_PER_FOOT;

                    return (
                      <Group
                        x={rectX + rectW / 2}
                        y={rectY + rectH / 2}
                        offsetX={90 / zoom}
                        offsetY={35 / zoom}
                      >
                        <Rect
                          width={180 / zoom}
                          height={70 / zoom}
                          fill="#1e293b"
                          cornerRadius={6 / zoom}
                          opacity={0.9}
                        />
                        <Text
                          text={`${formatFeetInches(w)} x ${formatFeetInches(h)}\nArea: ${Math.round(area)} sq ft\nMax Pallets: ${maxPallets}\nEst. (w/ Walkway): ${estPallets}`}
                          padding={8 / zoom}
                          fontSize={11 / zoom}
                          fill="white"
                          fontFamily="JetBrains Mono"
                          align="center"
                          width={180 / zoom}
                        />
                      </Group>
                    );
                  })()}
                </Group>
              )}

              {/* Selection Rect Preview */}
              {mode === 'multi-select' && selectionStart && selectionEnd && (
                <Rect
                  x={Math.min(selectionStart.x, selectionEnd.x) * PIXELS_PER_FOOT}
                  y={Math.min(selectionStart.y, selectionEnd.y) * PIXELS_PER_FOOT}
                  width={Math.abs(selectionEnd.x - selectionStart.x) * PIXELS_PER_FOOT}
                  height={Math.abs(selectionEnd.y - selectionStart.y) * PIXELS_PER_FOOT}
                  stroke="#4f46e5"
                  strokeWidth={1 / zoom}
                  fill="#4f46e520"
                  dash={[5, 5]}
                />
              )}

              {/* Placed Objects */}
              {activeRoom?.objects.map(obj => {
                const def = objectLibrary.find(d => d.id === obj.definitionId);
                if (!def) return null;
                
                return (
                  <ObjectOnCanvas 
                    key={obj.id}
                    obj={obj}
                    def={def}
                    zoom={zoom}
                    mode={mode}
                    onDragMove={(e) => handleObjectDragMove(obj.id, e)}
                    onDragEnd={(e) => handleObjectDragEnd(obj.id, e)}
                    onRotate={() => handleRotate(obj.id)}
                    onDelete={() => handleDeleteObject(obj.id)}
                    isSelected={selectedObjectId === obj.id}
                    isMultiSelected={selectedObjectIds.includes(obj.id)}
                    onSelect={() => {
                      if (mode === 'multi-select') {
                        if (selectedObjectIds.includes(obj.id)) {
                          setSelectedObjectIds(selectedObjectIds.filter(id => id !== obj.id));
                        } else {
                          setSelectedObjectIds([...selectedObjectIds, obj.id]);
                        }
                      } else {
                        setSelectedObjectId(obj.id);
                        setSelectedWallId(null);
                        setSelectedLabelId(null);
                      }
                    }}
                    isValid={isValidPlacement(obj, activeRoom)}
                  />
                );
              })}

              {/* Wall Measurements Overlay - Rendered after objects to stay on top */}
              {hoveredWall && activeRoom && (
                <WallMeasurements wall={hoveredWall} room={activeRoom} zoom={zoom} />
              )}

              {/* Labels */}
              {activeRoom?.labels?.map(label => (
                <LabelOnCanvas
                  key={label.id}
                  label={label}
                  zoom={zoom}
                  mode={mode}
                  isSelected={selectedLabelId === label.id}
                  onSelect={() => {
                    setSelectedLabelId(label.id);
                    setSelectedObjectId(null);
                    setSelectedWallId(null);
                  }}
                  onDelete={() => {
                    setRooms(rooms.map(r => r.id === activeRoomId ? {
                      ...r,
                      labels: r.labels?.filter(l => l.id !== label.id)
                    } : r));
                  }}
                  onRotate={() => {
                    setRooms(rooms.map(r => r.id === activeRoomId ? {
                      ...r,
                      labels: r.labels?.map(l => l.id === label.id ? { ...l, rotation: ((l.rotation || 0) + 90) % 360 } : l)
                    } : r));
                  }}
                  onDragEnd={(e) => {
                    const newX = snapToGrid(e.target.x() / PIXELS_PER_FOOT);
                    const newY = snapToGrid(e.target.y() / PIXELS_PER_FOOT);
                    setRooms(rooms.map(r => r.id === activeRoomId ? {
                      ...r,
                      labels: r.labels?.map(l => l.id === label.id ? { ...l, x: newX, y: newY } : l)
                    } : r));
                  }}
                />
              ))}
            </Layer>
          </Stage>
        </div>

        {/* Footer Info */}
        <div className="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
          <div className="bg-white/80 backdrop-blur-md border border-zinc-200 p-3 rounded-2xl shadow-lg text-[10px] font-mono text-zinc-500">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span>Cursor: {formatFeetInches(mousePos.x)}, {formatFeetInches(mousePos.y)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-zinc-400" />
              <span>Grid: 1ft x 1ft</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ToolButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all group",
        active ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "hover:bg-zinc-100 text-zinc-500"
      )}
    >
      {icon}
      <span className={cn("hidden lg:inline", active ? "block" : "group-hover:block")}>{label}</span>
    </button>
  );
}

function GridLayer({ zoom }: { zoom: number }) {
  const lines = [];
  const size = 500; // 500 feet
  const step = PIXELS_PER_FOOT;

  for (let i = -size; i <= size; i++) {
    lines.push(
      <Line
        key={`v-${i}`}
        points={[i * step, -size * step, i * step, size * step]}
        stroke="#e5e7eb"
        strokeWidth={1 / zoom}
      />
    );
    lines.push(
      <Line
        key={`h-${i}`}
        points={[-size * step, i * step, size * step, i * step]}
        stroke="#e5e7eb"
        strokeWidth={1 / zoom}
      />
    );
  }

  return <Group>{lines}</Group>;
}

function ObjectOnCanvas({ 
  obj, 
  def, 
  zoom, 
  mode,
  onDragMove,
  onDragEnd, 
  onRotate, 
  onDelete, 
  isSelected, 
  isMultiSelected,
  onSelect,
  isValid 
}: { 
  obj: PlacedObject, 
  def: ObjectDefinition, 
  zoom: number, 
  mode: string,
  onDragMove?: (e: any) => void,
  onDragEnd: (e: any) => void, 
  onRotate: () => void, 
  onDelete: () => void,
  isSelected: boolean,
  isMultiSelected?: boolean,
  onSelect: () => void,
  isValid: boolean
}) {
  const [isHovered, setIsHovered] = useState(false);
  const isMoveMode = mode === 'move' || (mode === 'multi-select' && isMultiSelected);
  const isDoor = def.type === 'door';
  const isRotated = obj.rotation === 90 || obj.rotation === 270;
  const currentW = isRotated ? def.length : def.width;
  const currentH = isRotated ? def.width : def.length;

  return (
    <Group
      x={obj.x * PIXELS_PER_FOOT}
      y={obj.y * PIXELS_PER_FOOT}
      rotation={obj.rotation}
      draggable={isMoveMode}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onDblClick={onRotate}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Highlight for multi-selection */}
      {isMultiSelected && (
        <Rect
          x={-def.width * PIXELS_PER_FOOT / 2 - 4 / zoom}
          y={-def.length * PIXELS_PER_FOOT / 2 - 4 / zoom}
          width={def.width * PIXELS_PER_FOOT + 8 / zoom}
          height={def.length * PIXELS_PER_FOOT + 8 / zoom}
          stroke="#4f46e5"
          strokeWidth={2 / zoom}
          dash={[4, 4]}
          cornerRadius={4 / zoom}
        />
      )}
      {isDoor ? (
        <Group>
          {/* Door Frame/Wall segment */}
          <Line
            points={[-def.width * PIXELS_PER_FOOT / 2, 0, def.width * PIXELS_PER_FOOT / 2, 0]}
            stroke="#1e293b"
            strokeWidth={4 / zoom}
          />
          {/* Door Leaf */}
          <Line
            points={[-def.width * PIXELS_PER_FOOT / 2, 0, -def.width * PIXELS_PER_FOOT / 2, -def.length * PIXELS_PER_FOOT]}
            stroke="#1e293b"
            strokeWidth={2 / zoom}
          />
          {/* Swing Arc */}
          <Arc
            x={-def.width * PIXELS_PER_FOOT / 2}
            y={0}
            innerRadius={def.width * PIXELS_PER_FOOT}
            outerRadius={def.width * PIXELS_PER_FOOT}
            angle={90}
            rotation={-90}
            stroke="#1e293b"
            strokeWidth={1 / zoom}
            dash={[2, 2]}
          />
          {/* Selection highlight for door */}
          {isSelected && (
            <Rect
              x={-def.width * PIXELS_PER_FOOT / 2 - 5}
              y={-def.length * PIXELS_PER_FOOT - 5}
              width={def.width * PIXELS_PER_FOOT + 10}
              height={def.length * PIXELS_PER_FOOT + 10}
              stroke="#4f46e5"
              strokeWidth={1 / zoom}
              dash={[5, 5]}
            />
          )}
        </Group>
      ) : (
        <Rect
          x={-def.width * PIXELS_PER_FOOT / 2}
          y={-def.length * PIXELS_PER_FOOT / 2}
          width={def.width * PIXELS_PER_FOOT}
          height={def.length * PIXELS_PER_FOOT}
          fill={isValid ? (isSelected ? "#e0e7ff" : "#ffffff") : "#fee2e2"}
          stroke={isValid ? (isSelected ? "#4f46e5" : "#cbd5e1") : "#ef4444"}
          strokeWidth={2 / zoom}
          cornerRadius={4 / zoom}
          shadowBlur={isSelected ? 10 : 0}
          shadowColor="#4f46e5"
          shadowOpacity={0.2}
        />
      )}
      
      {/* Label - Scale to fit or show on hover */}
      {!isDoor && (
        <Group rotation={-obj.rotation}>
          <Text
            text={def.name}
            x={-currentW * PIXELS_PER_FOOT / 2}
            y={-currentH * PIXELS_PER_FOOT / 2}
            width={currentW * PIXELS_PER_FOOT}
            height={currentH * PIXELS_PER_FOOT}
            fontSize={Math.min(16, (currentW * PIXELS_PER_FOOT) / 3, (currentH * PIXELS_PER_FOOT) / 3)}
            fill={isValid ? "#64748b" : "#ef4444"}
            fontFamily="JetBrains Mono"
            align="center"
            verticalAlign="middle"
            wrap="char"
            ellipsis={true}
            listening={false}
          />
        </Group>
      )}

      {/* Hover Tooltip */}
      {isHovered && (
        <Group y={-def.length * PIXELS_PER_FOOT / 2 - 20 / zoom}>
          <Rect
            x={-40 / zoom}
            width={80 / zoom}
            height={16 / zoom}
            fill="#1e293b"
            cornerRadius={4 / zoom}
            listening={false}
          />
          <Text
            text={def.name}
            x={-40 / zoom}
            width={80 / zoom}
            fontSize={10 / zoom}
            fill="white"
            align="center"
            padding={3 / zoom}
            listening={false}
          />
        </Group>
      )}

      {isSelected && (
        <Group>
          <Circle 
            x={def.width * PIXELS_PER_FOOT / 2} 
            y={-def.length * PIXELS_PER_FOOT / 2} 
            radius={8 / zoom} 
            fill="#ef4444" 
            onClick={onDelete}
          />
          <Text text="×" x={def.width * PIXELS_PER_FOOT / 2 - 3} y={-def.length * PIXELS_PER_FOOT / 2 - 5} fill="white" fontSize={12/zoom} />
          
          <Circle 
            x={0} 
            y={-def.length * PIXELS_PER_FOOT / 2 - 15} 
            radius={8 / zoom} 
            fill="#4f46e5" 
            onClick={onRotate}
          />
          <Text text="↻" x={-3} y={-def.length * PIXELS_PER_FOOT / 2 - 20} fill="white" fontSize={10/zoom} />
        </Group>
      )}
    </Group>
  );
}

function LabelOnCanvas({
  label,
  zoom,
  mode,
  isSelected,
  onSelect,
  onDelete,
  onRotate,
  onDragEnd
}: {
  label: any,
  zoom: number,
  mode: string,
  isSelected: boolean,
  onSelect: () => void,
  onDelete: () => void,
  onRotate: () => void,
  onDragEnd: (e: any) => void
}) {
  const isMoveMode = mode === 'move';
  
  return (
    <Group
      x={label.x * PIXELS_PER_FOOT}
      y={label.y * PIXELS_PER_FOOT}
      rotation={label.rotation || 0}
      draggable={isMoveMode}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onDblClick={onRotate}
    >
      <Text
        text={label.text}
        fontSize={label.fontSize * PIXELS_PER_FOOT}
        fill="#1e293b"
        fontFamily="JetBrains Mono"
        align="center"
        verticalAlign="middle"
        shadowBlur={isSelected ? 5 : 0}
        shadowColor="#4f46e5"
        offsetX={(label.text.length * label.fontSize * PIXELS_PER_FOOT * 0.6) / 2}
        offsetY={(label.fontSize * PIXELS_PER_FOOT) / 2}
      />
      {isSelected && (
        <Group>
          <Circle 
            x={0} 
            y={-(label.fontSize * PIXELS_PER_FOOT) - 10 / zoom} 
            radius={6 / zoom} 
            fill="#ef4444" 
            onClick={onDelete}
          />
          <Circle 
            x={0} 
            y={(label.fontSize * PIXELS_PER_FOOT) + 10 / zoom} 
            radius={6 / zoom} 
            fill="#4f46e5" 
            onClick={onRotate}
          />
        </Group>
      )}
    </Group>
  );
}

function WallMeasurements({ wall, room, zoom }: { wall: { start: Point, end: Point }, room: Room, zoom: number }) {
  const intersections = useMemo(() => {
    const pts: Point[] = [];
    
    // Boundary segments
    room.points.forEach((p, i) => {
      const next = room.points[(i + 1) % room.points.length];
      if ((p.x === wall.start.x && p.y === wall.start.y && next.x === wall.end.x && next.y === wall.end.y) ||
          (p.x === wall.end.x && p.y === wall.end.y && next.x === wall.start.x && next.y === wall.start.y)) {
        return;
      }
      const intersect = getLineIntersection(wall.start, wall.end, p, next);
      if (intersect) {
        const isEndpoint = (Math.abs(intersect.x - wall.start.x) < 0.01 && Math.abs(intersect.y - wall.start.y) < 0.01) ||
                           (Math.abs(intersect.x - wall.end.x) < 0.01 && Math.abs(intersect.y - wall.end.y) < 0.01);
        if (!isEndpoint) pts.push(intersect);
      }
    });

    // Temp walls
    room.tempWalls.forEach(tw => {
      if ((tw.start.x === wall.start.x && tw.start.y === wall.start.y && tw.end.x === wall.end.x && tw.end.y === wall.end.y) ||
          (tw.start.x === wall.end.x && tw.start.y === wall.end.y && tw.end.x === wall.start.x && tw.end.y === wall.start.y)) {
        return;
      }
      const intersect = getLineIntersection(wall.start, wall.end, tw.start, tw.end);
      if (intersect) {
        const isEndpoint = (Math.abs(intersect.x - wall.start.x) < 0.01 && Math.abs(intersect.y - wall.start.y) < 0.01) ||
                           (Math.abs(intersect.x - wall.end.x) < 0.01 && Math.abs(intersect.y - wall.end.y) < 0.01);
        if (!isEndpoint) pts.push(intersect);
      }
    });

    // Sort intersections by distance from wall.start
    return pts.sort((a, b) => {
      const distA = Math.sqrt(Math.pow(a.x - wall.start.x, 2) + Math.pow(a.y - wall.start.y, 2));
      const distB = Math.sqrt(Math.pow(b.x - wall.start.x, 2) + Math.pow(b.y - wall.start.y, 2));
      return distA - distB;
    });
  }, [wall, room]);

  const fullLength = Math.sqrt(Math.pow(wall.end.x - wall.start.x, 2) + Math.pow(wall.end.y - wall.start.y, 2));
  const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180 / Math.PI;

  const segments = useMemo(() => {
    const points = [
      0,
      ...intersections.map(pt => Math.sqrt(Math.pow(pt.x - wall.start.x, 2) + Math.pow(pt.y - wall.start.y, 2))),
      fullLength
    ];
    
    const segs = [];
    for (let i = 0; i < points.length - 1; i++) {
      const len = points[i+1] - points[i];
      if (len > 0.01) {
        segs.push({
          start: points[i],
          end: points[i+1],
          length: len
        });
      }
    }
    return segs;
  }, [intersections, fullLength, wall.start]);

  return (
    <Group 
      x={wall.start.x * PIXELS_PER_FOOT} 
      y={wall.start.y * PIXELS_PER_FOOT} 
      rotation={angle}
      listening={false}
    >
      {/* Full Length */}
      <Text
        text={formatFeetInches(fullLength)}
        x={fullLength * PIXELS_PER_FOOT / 2}
        y={-25 / zoom}
        fontSize={16 / zoom}
        fill="#4f46e5"
        fontFamily="JetBrains Mono"
        align="center"
        offsetX={(formatFeetInches(fullLength).length * 16 / zoom * 0.6) / 2}
      />

      {/* Segment Lengths */}
      {segments.length > 1 && segments.map((seg, idx) => (
        <Text
          key={`seg-${idx}`}
          text={formatFeetInches(seg.length)}
          x={(seg.start + seg.end) * PIXELS_PER_FOOT / 2}
          y={20 / zoom}
          fontSize={14 / zoom}
          fill="#4f46e5"
          fontFamily="JetBrains Mono"
          align="center"
          offsetX={(formatFeetInches(seg.length).length * 14 / zoom * 0.6) / 2}
        />
      ))}

      {/* Intersections */}
      {intersections.map((pt, idx) => {
        const dist = Math.sqrt(Math.pow(pt.x - wall.start.x, 2) + Math.pow(pt.y - wall.start.y, 2));
        return (
          <Group key={idx} x={dist * PIXELS_PER_FOOT}>
            <Line
              points={[0, -12 / zoom, 0, 12 / zoom]}
              stroke="#ef4444"
              strokeWidth={3 / zoom}
            />
          </Group>
        );
      })}
    </Group>
  );
}

function WallOnCanvas({ 
  wall, 
  zoom, 
  mode,
  onDragEnd, 
  onDelete,
  onHover,
  onUnhover,
  isSelected,
  onSelect
}: { 
  wall: TempWall, 
  zoom: number, 
  mode: string,
  onDragEnd: (e: any) => void, 
  onDelete: () => void,
  onHover: () => void,
  onUnhover: () => void,
  isSelected?: boolean,
  onSelect?: () => void
}) {
  const isMoveMode = mode === 'move';
  const dx = (wall.end.x - wall.start.x) * PIXELS_PER_FOOT;
  const dy = (wall.end.y - wall.start.y) * PIXELS_PER_FOOT;

  return (
    <Group
      x={wall.start.x * PIXELS_PER_FOOT}
      y={wall.start.y * PIXELS_PER_FOOT}
      draggable={isMoveMode}
      onDragEnd={onDragEnd}
      onMouseEnter={onHover}
      onMouseLeave={onUnhover}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect?.();
      }}
    >
      <Line
        points={[0, 0, dx, dy]}
        stroke={isSelected ? "#4f46e5" : (wall.color || "#64748b")}
        strokeWidth={(isSelected ? 6 : 4) / zoom}
        hitStrokeWidth={20 / zoom}
        dash={wall.isDashed ? [5, 5] : undefined}
        shadowBlur={isSelected ? 10 : 0}
        shadowColor="#4f46e5"
      />
      <Circle 
        x={0} 
        y={0} 
        radius={4 / zoom} 
        fill={isSelected ? "#4f46e5" : "#94a3b8"}
        onClick={onDelete}
      />
      <Circle 
        x={dx} 
        y={dy} 
        radius={4 / zoom} 
        fill={isSelected ? "#4f46e5" : "#94a3b8"}
        onClick={onDelete}
      />
    </Group>
  );
}
