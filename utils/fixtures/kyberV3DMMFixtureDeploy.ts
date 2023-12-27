import DeployHelper from "../deploys";
import { providers, Signer, BigNumber } from "ethers";
import { Address } from "../types";
import { Account } from "../test/types";
import { Contract } from "ethers";
import { IERC20 } from "@typechain/IERC20";

import { OracleMock } from "../contracts";
import {
  DMMPool,
  DMMFactory,
  DMMRouter02
} from "../contracts/kyberV3";

import { ether } from "../common";
import { DMMPool__factory } from "../../typechain/factories/DMMPool__factory";
import { ethers } from "hardhat";

export class KyberV3DMMFixtureDeploy {
  private _deployer: DeployHelper;
  private _ownerSigner: Signer;

  public owner: Account;
  public dmmFactory: DMMFactory;
  public dmmRouter: DMMRouter02;

  // make componentpools a map of token address to pool
  public componentPoolsMap: Map<Address, DMMPool> = new Map<Address, DMMPool>();

  constructor(provider: providers.Web3Provider | providers.JsonRpcProvider, ownerAddress: Address) {
    this._ownerSigner = provider.getSigner(ownerAddress);
    this._deployer = new DeployHelper(this._ownerSigner);
  }

  public async initialize(_owner: Account, _weth: IERC20, _components: Contract[], _oracles: OracleMock[]): Promise<void> {
    this.owner = _owner;
    this.dmmFactory = await this._deployer.external.deployDMMFactory(this.owner.address);
    this.dmmRouter = await this._deployer.external.deployDMMRouter02(this.dmmFactory.address, _weth.address);

    for (let i = 0; i < _components.length; i++) {
      const component = _components[i];
      const oracle = _oracles[i];
      const pool = await this.createNewPool(
        _weth.address,
        component.address,
        BigNumber.from(19000)   // Amp factor of 1.9 (in BPS) because correlated assets
      );
      this.componentPoolsMap.set(component.address, pool);

      // await pool.connect(_manager.wallet).mint(_manager.address);
      await this.addLiquidityToPool(pool, _owner, _weth, component, oracle);
    }

    console.log("Deployed Pools and added liquidity to them...");

  }

  /**
   * Creates new DMM pool. The token addresses are interchangeable.
   * NOTE: There can be at most 1 unamplified pool for a token pair, ie. only 1 pool can exist with ampBps = BPS (10000).
   * Should there already be an existing unamplified pool, attempts to create another one will fail.
   *
   * @param _token0     address of token 1
   * @param _token1     address of token 2
   * @param _ampBps     Amplification factor (in BPS)
   */
  public async createNewPool(_tokenA: Address, _tokenB: Address, _ampBps: BigNumber): Promise<DMMPool> {
    await this.dmmFactory.createPool(_tokenA, _tokenB, _ampBps);
    const poolAddress = await this.dmmFactory.allPools((await this.dmmFactory.allPoolsLength()).sub(1));
    return new DMMPool__factory(this._ownerSigner).attach(poolAddress);
  }

  public getTokenOrder(_tokenOne: Address, _tokenTwo: Address): [Address, Address] {
    return _tokenOne.toLowerCase() < _tokenTwo.toLowerCase() ? [_tokenOne, _tokenTwo] : [_tokenTwo, _tokenOne];
  }

  private async addLiquidityToPool(pool: DMMPool, manager: Account, weth: IERC20, component: Contract, oracle: OracleMock): Promise<void> {
    const oraclePrice = await oracle.read();

    const wethAmount = ether(0.6); // 800 WETH, for example
    const componentAmount = wethAmount.mul(oraclePrice).div(ether(1)); // Adjust based on the oracle price

    await weth.connect(manager.wallet).approve(this.dmmRouter.address, wethAmount);
    await component.connect(manager.wallet).approve(this.dmmRouter.address, componentAmount);

    await this.dmmRouter.connect(manager.wallet).addLiquidity(
      weth.address,
      component.address,
      pool.address,
      wethAmount,
      componentAmount,
      // Set minimum amounts to slightly less than the actual to account for slippage
      wethAmount.mul(99).div(100),
      componentAmount.mul(99).div(100),
      [0, ethers.constants.MaxUint256],
      manager.address,
      ethers.constants.MaxUint256
    );
  }
}
