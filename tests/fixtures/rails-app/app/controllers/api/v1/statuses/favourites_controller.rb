class Api::V1::Statuses::FavouritesController < ApplicationController
  def create
    FavouriteService.new.call(current_account, status)
    render json: status
  end

  def destroy
    render json: status
  end
end
