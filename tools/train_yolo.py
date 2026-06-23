#!/usr/bin/env python3
"""
Train a Beyblade detector with YOLOv8, then export for TensorFlow.js.

Prerequisites:
  pip install ultralytics tensorflowjs

Steps:
  1. Label images in Roboflow (classes: beyblade, beyblade_red, beyblade_blue)
  2. Export YOLOv8 dataset OR place data.yaml locally
  3. Run: python3 tools/train_yolo.py --data /path/to/data.yaml
  4. Convert: tensorflowjs_converter --input_format=tf_saved_model \
        --output_format=tfjs_graph_model ./runs/detect/train/weights/saved_model ../models/beyblade
  5. Copy metadata.json into models/beyblade/ and reload the web app
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Train YOLOv8 Beyblade detector")
    parser.add_argument("--data", required=True, help="Path to YOLO data.yaml")
    parser.add_argument("--model", default="yolov8n.pt", help="Base model")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--project", default="runs/detect")
    parser.add_argument("--name", default="beyblade")
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.model)
    results = model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        project=args.project,
        name=args.name,
    )

    best = Path(results.save_dir) / "weights" / "best.pt"
    print(f"Best weights: {best}")

    export_dir = Path(args.project) / args.name / "saved_model"
    model = YOLO(str(best))
    model.export(format="saved_model", imgsz=args.imgsz)
    print(f"SavedModel exported. Convert with tensorflowjs_converter to models/beyblade/")


if __name__ == "__main__":
    main()
