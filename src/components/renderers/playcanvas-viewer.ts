/* @license
 * Copyright 2020 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License atQ
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {css, html, LitElement} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import * as pc from 'playcanvas';

import {ScenarioConfig} from '../../common.js';

const $initialize = Symbol('initialize');
const $updateScenario = Symbol('updateScenario');
const $updateSize = Symbol('updateSize');
const $canvas = Symbol('canvas');
const $app = Symbol('app');
const $scene = Symbol('scene');
@customElement('playcanvas-viewer')
export class PlayCanvasViewer extends LitElement {
  @property({type: Object}) scenario: ScenarioConfig|null = null;
  private[$canvas]: HTMLCanvasElement|null = null;
  private[$app]!: pc.AppBase;
  private[$scene]!: pc.Scene;

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    this[$updateSize]();

    if (changedProperties.has('scenario') && this.scenario != null) {
      this[$updateScenario](this.scenario);
    }
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }
    `;
  }

  render() {
    return html`<canvas id="canvas"></canvas>`;
  }

  private async[$initialize]() {
    this[$canvas] = this.shadowRoot!.querySelector('canvas');
    if (!this[$canvas]) return;

    const gfxOptions = {
      deviceTypes: [pc.DEVICETYPE_WEBGL2],
    };
  
    const device = await pc.createGraphicsDevice(this[$canvas], gfxOptions);
    device.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
    const createOptions = new pc.AppOptions();
    createOptions.graphicsDevice = device;
    createOptions.mouse = new pc.Mouse(document.body);
    createOptions.touch = new pc.TouchDevice(document.body);
    createOptions.keyboard = new pc.Keyboard(document.body);
    createOptions.componentSystems = [
      pc.RenderComponentSystem,
      pc.CameraComponentSystem,
      pc.LightComponentSystem,
      pc.ScriptComponentSystem
    ];
    createOptions.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler, pc.ScriptHandler];
  
    // Application Initialization
    this[$app] = new pc.AppBase(this[$canvas]);
    this[$app].init(createOptions);

    this[$updateSize]();

    this[$scene] = this[$app].scene;
    this[$app].start();
  }

  private async[$updateScenario](scenario: ScenarioConfig) {
    if (this[$app] == null || !this[$scene] || !this[$scene].root) {
      await this[$initialize]();
      if (!this[$scene]) {
        console.error('Failed to initialize PlayCanvas scene');
        return;
      }
    }

    const iblRotation = +270;

    // Camera Settings
    const camera = new pc.Entity('camera');
    camera.addComponent('camera', {
      clearColorBuffer: true,
      clearColor: new pc.Color(0, 0, 0, 0),
      fov: scenario.verticalFoV // degree指定
    });
    this[$app].root.addChild(camera);

    // Camera Position
    const {orbit, target} = scenario;
    const theta = (orbit.theta) * Math.PI / 180;
    const phi = (orbit.phi) * Math.PI / 180;
    const radiusSinPhi = orbit.radius * Math.sin(phi);
    camera.setLocalPosition(
      radiusSinPhi * Math.sin(theta) + target.x,
      orbit.radius * Math.cos(phi) + target.y,
      radiusSinPhi * Math.cos(theta) + target.z
    );
    camera.lookAt(target.x, target.y, target.z);

    const assets = {
      model: new pc.Asset('model', 'container', {
        url: scenario.model
      }),
      hdri: new pc.Asset(
        'hdri',
        'texture',
        { url: scenario.lighting },
        { mipmaps: false }
      )
    };

    const assetListLoader = new pc.AssetListLoader(Object.values(assets), this[$app].assets);
    assetListLoader.load(() => {
      const container = assets.model.resource as any;
      if (container && typeof container.instantiateRenderEntity === 'function') {
        const modelEntity = container.instantiateRenderEntity();
        this[$app].root.addChild(modelEntity);
      } else {
        console.error('Failed to instantiate model entity');
      }


      // apply hdri texture
      const applyHdri = (source: any) => {
        // convert it to high resolution cubemap for the skybox
        // this is optional in case you want a really high resolution skybox
        const skybox = pc.EnvLighting.generateSkyboxCubemap(source);
        this[$app].scene.skybox = skybox;

        // generate env-atlas texture for the lighting
        // this would also be used as low resolution skybox if high resolution is not available
        const lighting = pc.EnvLighting.generateLightingSource(source);
        const envAtlas = pc.EnvLighting.generateAtlas(lighting);
        lighting.destroy();
        this[$app].scene.envAtlas = envAtlas;

        this[$app].scene.skyboxRotation = new pc.Quat().setFromEulerAngles(0, iblRotation, 0);

        if (!scenario.renderSkybox) {
          const skyboxLayer = this[$app].scene.layers.getLayerByName('Skybox');
          skyboxLayer!.enabled = false;
        }
      };
      
      applyHdri(assets.hdri.resource);

      this[$app].on('postrender', () => {
        setTimeout(() => {
          this.dispatchEvent(
            new CustomEvent('model-visibility', {detail: {visible: true}})
          );
        }, 100);
      });
    });

  }

  private[$updateSize]() {
    if (this[$canvas] == null || this.scenario == null) {
      return;
    }

    const canvas = this[$canvas]!;
    const {dimensions} = this.scenario;

    const dpr = window.devicePixelRatio;
    const width = dimensions.width * dpr;
    const height = dimensions.height * dpr;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;

    if (this[$app]) {
      this[$app].setCanvasFillMode(pc.FILLMODE_NONE);
      this[$app].setCanvasResolution(pc.RESOLUTION_FIXED, dimensions.width, dimensions.height);
    }
  }
}
