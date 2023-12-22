import { providers } from "ethers";
import { ContractTransaction, Signer } from "ethers";
import { BigNumber } from "ethers";
import { IERC20 } from "@typechain/IERC20";

import {
  BasicIssuanceModule,
  Controller,
  IntegrationRegistry,
  OracleMock,
  PriceOracle,
  SetToken,
  SetTokenCreator,
  SetValuer,
  StandardTokenMock,
  StreamingFeeModule,
  WETH9,
  CustomOracleNavIssuanceModule
} from "../contracts";
import DeployHelper from "../deploys";
import {
  ether,
  ProtocolUtils,
} from "../common";
import {
  Address,
} from "../types";

import { SetToken__factory } from "../../typechain/factories/SetToken__factory";

export class SystemFixtureDeploy {
  private _provider: providers.Web3Provider | providers.JsonRpcProvider;
  private _ownerAddress: Address;
  private _ownerSigner: Signer;
  private _deployer: DeployHelper;

  public feeRecipient: Address;

  public controller: Controller;
  public factory: SetTokenCreator;
  public priceOracle: PriceOracle;
  public integrationRegistry: IntegrationRegistry;
  public setValuer: SetValuer;

  public issuanceModule: BasicIssuanceModule;
  public streamingFeeModule: StreamingFeeModule;
  public navIssuanceModule: CustomOracleNavIssuanceModule;

  public weth: WETH9;
  public wbtc: StandardTokenMock;
  public usdc: StandardTokenMock;
  public dai: StandardTokenMock;

  public components: IERC20[] = [];
  public oracles: OracleMock[] = [];

  constructor(provider: providers.Web3Provider | providers.JsonRpcProvider, ownerAddress: Address) {
    this._provider = provider;
    this._ownerAddress = ownerAddress;
    this._ownerSigner = provider.getSigner(ownerAddress);
    this._deployer = new DeployHelper(this._ownerSigner);
  }

  public async initialize(): Promise<void> {

    // Choose an arbitrary address as fee recipient
    this.feeRecipient = "0x60E9eD31b7A5a5270e370d8f8979d33780E9E2d0";

    this.controller = await this._deployer.core.deployController(this.feeRecipient);
    this.issuanceModule = await this._deployer.modules.deployBasicIssuanceModule(this.controller.address);

    await this.initializeStandardComponents();

    this.factory = await this._deployer.core.deploySetTokenCreator(this.controller.address);
    this.priceOracle = await this._deployer.core.deployPriceOracle(
      this.controller.address,
      this.weth.address,
      [],
      this.components.map(component => component.address),
      this.components.map(() => this.weth.address),
      this.oracles.map(oracle => oracle.address),
    );

    this.integrationRegistry = await this._deployer.core.deployIntegrationRegistry(this.controller.address);

    this.setValuer = await this._deployer.core.deploySetValuer(this.controller.address);
    this.streamingFeeModule = await this._deployer.modules.deployStreamingFeeModule(this.controller.address);
    this.navIssuanceModule = await this._deployer.modules.deployCustomOracleNavIssuanceModule(this.controller.address, this.weth.address);

    await this.controller.initialize(
      [this.factory.address], // Factories
      [this.issuanceModule.address, this.streamingFeeModule.address, this.navIssuanceModule.address], // Modules
      [this.integrationRegistry.address, this.priceOracle.address, this.setValuer.address], // Resources
      [0, 1, 2]  // Resource IDs where IntegrationRegistry is 0, PriceOracle is 1, SetValuer is 2
    );
  }

  public async initializeStandardComponents(): Promise<void> {
    this.weth = await this._deployer.external.deployWETH();
    this.wbtc = await this._deployer.mocks.deployTokenMock(this._ownerAddress, ether(1000000), 8);
    this.usdc = await this._deployer.mocks.deployTokenMock(this._ownerAddress, ether(1000000), 6);
    this.dai = await this._deployer.mocks.deployTokenMock(this._ownerAddress, ether(1000000), 18);

    for (let i = 0; i < 10; i++) {
      this.components.push(await this._deployer.mocks.deployTokenMock(this._ownerAddress, ether(10000), 18));
      await this.components[i].approve(this.issuanceModule.address, ether(10000));
    }

    for (let i = 0; i < 10; i++) {
      this.oracles.push(await this._deployer.mocks.deployOracleMock(ether(i + 1)));
    }

  }

  public async createSetToken(
    components: Address[],
    units: BigNumber[],
    modules: Address[],
    manager: Address = this._ownerAddress,
    name: string = "SetToken",
    symbol: string = "SET",
  ): Promise<SetToken> {
    const txHash: ContractTransaction = await this.factory.create(
      components,
      units,
      modules,
      manager,
      name,
      symbol,
    );

    const retrievedSetAddress = await new ProtocolUtils(this._provider).getCreatedSetTokenAddress(txHash.hash);

    return new SetToken__factory(this._ownerSigner).attach(retrievedSetAddress);
  }
}
